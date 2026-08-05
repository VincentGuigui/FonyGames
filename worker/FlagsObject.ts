import { DurableObject } from 'cloudflare:workers';
import {
  authorised,
  empty,
  publicFlags,
  redeemLink,
  requestLink,
  setFlag,
  state,
  type Admin,
  type Ctx,
} from './admin';
import type { FlagState } from '../shared/flags';

/**
 * The one object that holds the flags and the admin session state.
 * Spec: docs/specs/backoffice.md §2b, §4
 *
 * A **singleton**: `idFromName('flags')`, so there is exactly one per Worker and
 * therefore per environment. dev and prod are separate Workers with separate
 * namespaces, so their flags are separate by construction and cost nothing to keep
 * apart (spec §2b).
 *
 * Its own class rather than a specially-named `Room`. The spec's wording allows either,
 * but `Room.ts` is the referee for five games and 800 lines of round logic — giving it a
 * second job called "also be the backoffice" is how that file becomes unreadable. The
 * cost is one binding and one migration tag, paid once.
 *
 * All the actual rules live in `admin.ts`, driven through a `Ctx`, so the harness tests
 * them on plain Node. This class is the plumbing: storage, secrets, and the mailer.
 */

export type FlagsEnv = {
  ADMIN_EMAIL?: string;
  ADMIN_SESSION_KEY?: string;
  ADMIN_TOKEN?: string;
  MAIL_SECRET?: string;
  MAIL_ENDPOINT?: string;
  /** Where a magic link should point, e.g. `https://fonygames.guigui.fr/ops-x/`. */
  ADMIN_LINK_BASE?: string;
};

export class FlagsObject extends DurableObject<FlagsEnv> {
  #ctx(): Ctx {
    const env = this.env;
    const storage = this.ctx.storage;
    return {
      now: () => Date.now(),
      load: async () => (await storage.get<Admin>('admin')) ?? null,
      save: async (a) => {
        await storage.put('admin', a);
      },
      // `?? ''` rather than a throw: admin.ts treats an empty secret as matching
      // nobody, which is the safe reading of "not configured yet". A throw here would
      // turn an unset secret into a 500 and make the endpoint's shape observable.
      adminEmail: () => env.ADMIN_EMAIL ?? '',
      sessionKey: () => env.ADMIN_SESSION_KEY ?? '',
      adminToken: () => env.ADMIN_TOKEN ?? '',
      linkBase: () => env.ADMIN_LINK_BASE ?? 'https://fonygames.guigui.fr/ops/',
      sendMail: async (to, subject, body) => {
        const endpoint = env.MAIL_ENDPOINT;
        const secret = env.MAIL_SECRET;
        if (!endpoint || !secret) {
          // Loud, because the alternative is a link nobody receives and no clue why.
          throw new Error('MAIL_ENDPOINT or MAIL_SECRET is not configured');
        }
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ to, subject, body }),
        });
        if (!res.ok) {
          // The status is the one thing worth carrying: 401 means the two MAIL_SECRET
          // copies disagree, which is the failure deployment.md §3.6 cannot check for.
          throw new Error(`mailer refused: ${res.status}`);
        }
      },
    };
  }

  /** What the hub reads. No audit trail, no hint that an admin exists. */
  async flags(): Promise<unknown> {
    return publicFlags(this.#ctx());
  }

  /** Availability for one slug, for the room-open gate. */
  async availabilityOf(slug: string): Promise<FlagState> {
    const { flags } = await publicFlags(this.#ctx());
    return flags[slug]?.availability ?? 'active';
  }

  async requestLink(email: string): Promise<void> {
    // The outcome is deliberately dropped: the route replies 204 either way, so that a
    // wrong address cannot be told apart from the right one (admin.ts).
    await requestLink(this.#ctx(), email);
  }

  async redeem(token: string): Promise<string | null> {
    return redeemLink(this.#ctx(), token);
  }

  async check(header: string | null): Promise<boolean> {
    return authorised(this.#ctx(), header);
  }

  async fullState(): Promise<Admin> {
    return state(this.#ctx());
  }

  async set(
    slug: string,
    patch: { availability?: FlagState; isNew?: boolean; reason?: string },
  ): Promise<unknown> {
    return setFlag(this.#ctx(), slug, patch);
  }

  /**
   * Prove the two `MAIL_SECRET` copies match, which nothing else can.
   *
   * The deploy's pre-flight can only check that the GitHub copy is *present* — it has no
   * access to the Wrangler one (docs/deployment.md §3.6). So the operator gets this: a
   * real call to the mailer, with a payload it is expected to accept and not send.
   * Without it a mismatch looks exactly like mail going to spam.
   */
  async mailCheck(): Promise<{ ok: boolean; detail: string }> {
    try {
      await this.#ctx().sendMail('', 'ping', '');
      return { ok: true, detail: 'the mailer accepted a no-op payload' };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        detail: detail.includes('401')
          ? 'the mailer rejected the secret — the two MAIL_SECRET copies disagree'
          : detail,
      };
    }
  }

  /** Never called in production; here so a fresh object has a defined shape. */
  async reset(): Promise<void> {
    await this.ctx.storage.put('admin', empty());
  }
}
