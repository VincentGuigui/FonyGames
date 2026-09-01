/**
 * Reading the published flags, from the room-open path.
 * Spec: docs/specs/backoffice.md §2b
 *
 * PHP owns the flags and republishes a flat `flags.json` on every write. This is the
 * Worker's half: fetch that file, cache it, and **never** let it get in the way of a
 * round.
 *
 * ## Everything here is shaped by where it is called from
 *
 * `stateOf()` runs while a player is opening a room, inside the ±250 ms budget
 * in `docs/architecture.md` §4. That single fact explains every decision below:
 *
 * - **A 60 s memory cache**, because a flag changes a few times a year and a room
 *   opens far more often than that.
 * - **One in-flight request, shared.** Without coalescing, a burst of joins on a cold
 *   Worker fires one fetch per join.
 * - **A hard timeout.** A shared host that accepts a connection and then stops
 *   talking would otherwise hang every room-open until the platform gives up. A slow
 *   flags file must cost a round nothing.
 * - **Stale beats correct.** On any failure the last good copy is served *past* its
 *   TTL, indefinitely. A newly-disabled game staying playable for a while is a much
 *   smaller problem than the catalogue going dark.
 * - **No copy at all ⇒ everything is `active`.** Fail open, as `shared/flags.ts`
 *   documents, with the consequence stated there rather than discovered: a flag is
 *   not a security control.
 *
 * Nothing in this file imports `cloudflare:workers`, so `worker/flags.test.ts` drives
 * it on plain Node with an injected clock and fetch (docs/testing.md §1.1).
 */

import type { FlagState, GameFlag } from '../shared/flags';
import { DEFAULT_FLAG } from '../shared/flags';
import { gameSlug } from './router';

/** How long a fetched copy is fresh. */
export const FLAGS_TTL_MS = 60_000;

/** How long to wait for the file before giving up on it. */
export const FLAGS_TIMEOUT_MS = 1_500;

export type Fetcher = (url: string, timeoutMs: number) => Promise<Response>;

export type FlagsDeps = {
  /** `undefined` or empty means "no flags configured" — every game is active. */
  url: string | undefined;
  now: () => number;
  fetcher: Fetcher;
  ttlMs?: number;
};

export type FlagsReader = {
  /** The state for one slug. Never throws, never rejects. */
  stateOf(slug: string): Promise<FlagState>;
  /** The whole map, for callers that want more than one answer. */
  all(): Promise<Record<string, GameFlag>>;
};

/**
 * `fetch` with a deadline.
 *
 * `AbortSignal.timeout` rather than a `Promise.race`: race leaves the request running
 * and, on a Worker, an outstanding request can outlive the event that started it. The
 * signal actually cancels.
 */
export const timedFetch: Fetcher = (url, timeoutMs) =>
  fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    // The Worker does its own caching below, and Cloudflare's would add a second
    // layer with a different TTL — two answers to "how stale is this?" is one too
    // many when the whole point is knowing.
    cf: { cacheTtl: 0 },
  } as RequestInit);

/**
 * Parse and sanitise the published document.
 *
 * Exported because it is the part worth testing hardest: this string comes off a web
 * server over the network, and a slug from it is handed to nothing less than a URL.
 * **Anything unexpected yields an empty map**, which reads as "all active".
 */
export function parseFlags(body: unknown): Record<string, GameFlag> {
  if (typeof body !== 'object' || body === null) return {};
  const flags = (body as { flags?: unknown }).flags;
  if (typeof flags !== 'object' || flags === null || Array.isArray(flags)) return {};

  const out: Record<string, GameFlag> = {};
  for (const [rawSlug, rawFlag] of Object.entries(flags as Record<string, unknown>)) {
    // The same guard the socket path applies. The file lives on a host we do not
    // control the contents of by hand, so it is re-checked here rather than trusted.
    if (gameSlug(rawSlug) === null) continue;
    if (typeof rawFlag !== 'object' || rawFlag === null) continue;

    const { state, reason } = rawFlag as Record<string, unknown>;
    const flag: GameFlag = {
      state:
        state === 'new' || state === 'active' || state === 'soon' || state === 'hidden'
          ? state
          : DEFAULT_FLAG.state,
    };
    if (typeof reason === 'string' && reason.trim() !== '') flag.reason = reason.trim();

    out[rawSlug] = flag;
  }
  return out;
}

/**
 * One reader per Worker isolate. Created at module scope in `index.ts`, so the cache
 * survives between requests for as long as the isolate does.
 */
export function makeFlagsReader(deps: FlagsDeps): FlagsReader {
  const ttl = deps.ttlMs ?? FLAGS_TTL_MS;

  /** The last copy that parsed. `null` until one has. */
  let good: Record<string, GameFlag> | null = null;
  let goodAt = 0;
  /** The one outstanding fetch, so concurrent joins share it. */
  let inFlight: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const url = deps.url;
    if (!url) return;

    try {
      const res = await deps.fetcher(url, FLAGS_TIMEOUT_MS);
      if (!res.ok) return;
      const parsed = parseFlags(await res.json());
      good = parsed;
      goodAt = deps.now();
    } catch {
      // Timeout, DNS, TLS, a truncated body, invalid JSON. All the same answer:
      // keep whatever we had. Deliberately silent — this runs on every cold
      // room-open and a log line per join would be noise, not signal.
    }
  }

  async function current(): Promise<Record<string, GameFlag>> {
    const fresh = good !== null && deps.now() - goodAt < ttl;
    if (fresh) return good as Record<string, GameFlag>;

    // Coalesce. `inFlight` is cleared by the same promise that set it, so a failed
    // refresh does not wedge the reader into never trying again.
    inFlight ??= refresh().finally(() => {
      inFlight = null;
    });
    await inFlight;

    // `good` may still be null (never fetched successfully) or stale (the refresh
    // failed and we kept the old copy). Both are answers, and both are correct here.
    return good ?? {};
  }

  return {
    all: current,
    async stateOf(slug: string): Promise<FlagState> {
      const flags = await current();
      return flags[slug]?.state ?? DEFAULT_FLAG.state;
    },
  };
}
