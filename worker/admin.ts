import type { GameFlag, FlagState, PublicFlags } from '../shared/flags';
import { DEFAULT_FLAG, mayOpenRoom } from '../shared/flags';

/**
 * The backoffice's server side: feature flags, and who is allowed to change them.
 * Spec: docs/specs/backoffice.md §2b, §4
 *
 * Everything privileged lives here rather than on the web host, because the Worker is
 * the only thing that can *enforce* a flag — hiding a card is cosmetic, and a
 * bookmarked `/tap-duel/#AB2C` never consults the grid (spec §2b).
 *
 * ## The shape of the auth, and why each piece exists
 *
 * There is one operator and one address. So: no accounts, no password, no reset. A
 * single-use link to `ADMIN_EMAIL` authenticates and the mailbox is the second factor.
 * The hidden URL is **not** the security and the spec says so; it stops crawlers.
 *
 * Five details below are each guarding a specific hole, and are the reason this is not
 * twenty lines:
 *
 * - **Constant-time compare, identical reply.** A wrong address gets the same `204` as
 *   the right one, so the endpoint cannot be used to discover who the operator is.
 * - **Hashed at rest, single use, ten minutes.** The stored token is a SHA-256; a
 *   redeem deletes it. A leaked backup is not a key.
 * - **Rate limited.** Without it, `requestLink` is a way to spam the operator's inbox
 *   from anywhere in the world.
 * - **HMAC session, not a guessable id.** The Worker keeps no session table: the token
 *   carries its own expiry and a signature over it.
 * - **`ADMIN_TOKEN` break-glass.** A dead mailbox must not lock the operator out of
 *   their own flags.
 *
 * WebCrypto is used directly rather than injected: `crypto.subtle` exists in
 * workerd and in Node, so the harness runs the real thing.
 */

export type Admin = {
  flags: Record<string, GameFlag>;
  /** SHA-256 hex of the outstanding magic-link token. One at a time. */
  linkHash: string | null;
  /** Server time the outstanding token stops working. */
  linkExpires: number;
  /** Server times of recent link requests, for the rate limit. */
  recent: number[];
  /**
   * Who changed what, when. MySQL gets the durable copy (spec §2b); this is the tail
   * the operator can see without leaving the page.
   */
  log: { at: number; what: string }[];
};

export type Ctx = {
  now(): number;
  load(): Promise<Admin | null>;
  save(a: Admin): Promise<void>;
  /** The one address a link may go to. */
  adminEmail(): string;
  /** HMAC key for session tokens. */
  sessionKey(): string;
  /** Break-glass bearer from §4. */
  adminToken(): string;
  /** Deliver the link. Rejections are swallowed by the caller — see requestLink. */
  sendMail(to: string, subject: string, body: string): Promise<void>;
  /** Where the link points. */
  linkBase(): string;
};

/** How long a magic link works for. Long enough to switch to a mail app, no longer. */
export const LINK_TTL_MS = 10 * 60_000;

/** A session lasts a working session, then you click a new link. */
export const SESSION_TTL_MS = 12 * 60 * 60_000;

/** Link requests allowed per window, so the endpoint is not an inbox-spam gadget. */
export const LINK_MAX = 5;
export const LINK_WINDOW_MS = 60 * 60_000;

/** How many audit lines to keep in the object. */
const LOG_KEEP = 50;

export function empty(): Admin {
  return { flags: {}, linkHash: null, linkExpires: 0, recent: [], log: [] };
}

/* ------------------------------------------------------------------ */
/* crypto helpers                                                       */
/* ------------------------------------------------------------------ */

const enc = new TextEncoder();

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256(s: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

/**
 * Compare without leaking *where* two strings differ through timing.
 *
 * Lengths are folded in rather than short-circuited on, so a wrong-length guess is not
 * distinguishable from a wrong-content one.
 */
export function sameSecret(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** URL-safe random token. 32 bytes, so guessing is not a strategy. */
export function mintToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

async function hmac(key: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/* ------------------------------------------------------------------ */
/* the magic link                                                       */
/* ------------------------------------------------------------------ */

/** What the caller should reply. Always the same status — see `requestLink`. */
export type LinkOutcome = 'sent' | 'ignored' | 'rate-limited';

/**
 * Ask for a link.
 *
 * The **outcome is for logs and tests, not for the response body**: the HTTP layer
 * replies `204` for every one of these. A different status for a wrong address would
 * turn this endpoint into a way to find out who the operator is.
 *
 * Email is trimmed and lowercased before comparing, because a mail address is not case
 * sensitive in its domain and nobody types their own address consistently.
 */
export async function requestLink(
  ctx: Ctx,
  email: string,
  now = ctx.now(),
): Promise<LinkOutcome> {
  const a = (await ctx.load()) ?? empty();

  // The window is pruned before the check, so an old burst does not lock the operator
  // out for the rest of the hour.
  a.recent = a.recent.filter((t) => now - t < LINK_WINDOW_MS);
  if (a.recent.length >= LINK_MAX) {
    await ctx.save(a);
    return 'rate-limited';
  }
  a.recent.push(now);

  const wanted = ctx.adminEmail().trim().toLowerCase();
  const got = (email ?? '').trim().toLowerCase();
  // Still saved, so a wrong address is rate limited exactly like a right one. Bailing
  // out earlier would make the limit itself an oracle.
  if (wanted === '' || !sameSecret(wanted, got)) {
    await ctx.save(a);
    return 'ignored';
  }

  const token = mintToken();
  a.linkHash = await sha256(token);
  a.linkExpires = now + LINK_TTL_MS;
  await ctx.save(a);

  // The token goes in the FRAGMENT. A fragment is never sent to a server, so it cannot
  // land in an access log or a Referer header on the way (spec §4).
  const url = `${ctx.linkBase()}#${token}`;
  await ctx.sendMail(
    wanted,
    'FonyGames admin link',
    `Open the admin centre:\n\n${url}\n\nIt works once, for ten minutes.\n` +
      `If you did not ask for this, ignore it — nobody else can use it.\n`,
  );
  return 'sent';
}

/**
 * Trade a link token for a session. Null when it is wrong, used, or expired.
 *
 * The stored hash is cleared **whatever the outcome of a matching attempt**, so a token
 * is single use even if the caller crashes before using the session.
 */
export async function redeemLink(
  ctx: Ctx,
  token: string,
  now = ctx.now(),
): Promise<string | null> {
  const a = await ctx.load();
  if (!a || !a.linkHash) return null;
  if (now >= a.linkExpires) {
    a.linkHash = null;
    await ctx.save(a);
    return null;
  }
  const got = await sha256(token ?? '');
  if (!sameSecret(a.linkHash, got)) return null;

  a.linkHash = null;
  a.log.push({ at: now, what: 'signed in' });
  a.log = a.log.slice(-LOG_KEEP);
  await ctx.save(a);
  return issueSession(ctx, now + SESSION_TTL_MS);
}

async function issueSession(ctx: Ctx, expires: number): Promise<string> {
  const sig = await hmac(ctx.sessionKey(), String(expires));
  return `${expires}.${sig}`;
}

/**
 * Is this `Authorization` header good?
 *
 * Accepts either a session minted above or the `ADMIN_TOKEN` break-glass. Signature is
 * recomputed rather than looked up: the Worker keeps no session table, so signing out
 * everywhere means rotating `ADMIN_SESSION_KEY`, which is written down in the spec.
 */
export async function authorised(
  ctx: Ctx,
  header: string | null,
  now = ctx.now(),
): Promise<boolean> {
  const bearer = /^Bearer (.+)$/.exec(header ?? '')?.[1]?.trim();
  if (!bearer) return false;

  const fixed = ctx.adminToken();
  if (fixed !== '' && sameSecret(fixed, bearer)) return true;

  const dot = bearer.indexOf('.');
  if (dot <= 0) return false;
  const expires = Number(bearer.slice(0, dot));
  if (!Number.isFinite(expires) || now >= expires) return false;
  return sameSecret(await hmac(ctx.sessionKey(), String(expires)), bearer.slice(dot + 1));
}

/* ------------------------------------------------------------------ */
/* the flags                                                            */
/* ------------------------------------------------------------------ */

/** Everything the operator sees, plus the audit tail. */
export async function state(ctx: Ctx): Promise<Admin> {
  return (await ctx.load()) ?? empty();
}

/**
 * What the hub reads. Public and cacheable, so it carries **no** audit trail and no
 * hint that an admin exists.
 */
export async function publicFlags(ctx: Ctx): Promise<PublicFlags> {
  const a = await ctx.load();
  return { flags: a?.flags ?? {} };
}

/**
 * Set one game's flag. `patch` is partial so the two fields move independently — which
 * is the whole point of them being separate (spec §5).
 */
export async function setFlag(
  ctx: Ctx,
  slug: string,
  patch: { availability?: FlagState; isNew?: boolean; reason?: string },
  now = ctx.now(),
): Promise<GameFlag> {
  const a = (await ctx.load()) ?? empty();
  const before = a.flags[slug] ?? DEFAULT_FLAG;
  const next: GameFlag = {
    availability: patch.availability ?? before.availability,
    isNew: patch.isNew ?? before.isNew,
  };
  // Only carried when there is one, so `exactOptionalPropertyTypes` stays happy and a
  // cleared reason really is absent rather than an empty string.
  const reason = patch.reason ?? before.reason;
  if (reason !== undefined && reason !== '') next.reason = reason;

  a.flags[slug] = next;
  a.log.push({
    at: now,
    what: `${slug}: ${before.availability}${before.isNew ? ' +new' : ''} -> ` +
      `${next.availability}${next.isNew ? ' +new' : ''}`,
  });
  a.log = a.log.slice(-LOG_KEEP);
  await ctx.save(a);
  return next;
}

export { mayOpenRoom, DEFAULT_FLAG };
