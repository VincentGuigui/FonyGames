import type { PlayerLimits } from '../../../shared/players';

/** Input a game relies on. Drives the icons on the hub card. */
export type GameInput =
  | 'touch'
  | 'motion'
  | 'orientation'
  | 'gps'
  | 'compass'
  /**
   * The rear camera, as **scenery** rather than input. Ghost Hunt draws the live feed
   * behind its detector ring; no game reads a pixel of it for gameplay, and nothing
   * leaves the phone (docs/specs/games/ghost-hunt.md §10). Listed on the card anyway,
   * because a player deserves to know a game will ask before they open it.
   */
  | 'camera'
  | 'mic';

/**
 * A game's own merchandising/filter labels — never inferred, always written by hand
 * per game (a game is 1–3 of these). Drives the hub's filter chips
 * (docs/specs/hub.md §3) and, like `GameInput`, is a closed set: adding a value means
 * this type, a `UiStrings.tag` entry in both languages (`core/i18n/strings.ts`), and
 * tagging whichever games actually earn it.
 */
export type GameTag =
  | 'party'
  | 'duel'
  | 'physical'
  | 'outdoors'
  | 'strategy'
  | 'arcade'
  | 'augmented-reality'
  | 'luck'
  | 'music'
  | 'intense';

/**
 * The card illustration.
 *
 * Both halves or neither: an image without alt text breaks
 * docs/design/ui-guidelines.md §6, so they are one field and the type makes the
 * alt impossible to forget.
 */
export type GameArt = {
  /**
   * Always from a `?url&no-inline` import of the game's own `art/card.svg`, so it
   * ships as a separate hashed file instead of base64 inside the hub chunk
   * (docs/architecture.md §4, docs/design/illustrations.md §2).
   */
  src: string;
  /** What the illustration SHOWS — the action, not the title. */
  alt: string;
};

export type GameMode = {
  id: string;
  name: string;
  blurb: string;
};

/**
 * Everything the hub needs to sell a game, and nothing else — the hub must not
 * know how a game works. See docs/architecture.md §3.
 */
export type GameCard = {
  /** kebab-case; matches the URL, the spec filename and the code folder. */
  slug: string;
  title: string;
  /** ONE catchy sentence, <= 60 chars, no trailing period. */
  pitch: string;
  /**
   * The one idea the game turns on, in a single sentence.
   *
   * Not the pitch: the pitch sells the game on the hub, this explains the thing
   * you have to *understand* to play it well. It leads the how-to-play panel,
   * above the bullets, because a player who grasps the concept can work out the
   * mechanics and a player who only knows the mechanics often cannot.
   */
  concept: string;
  /**
   * How to play, in 2–3 short sentences.
   *
   * ONE source for three places: the lobby, the four-second panel at the top of
   * a round, and the in-game menu. Written here so they can never drift — if
   * the rules differ between the lobby and the game, one of them is lying.
   *
   * Keep each bullet under about 60 characters: it has to be readable in the
   * four seconds the pre-round panel is on screen.
   */
  rules: string[];
  art: GameArt;
  /** Accent colour, from the game's spec. */
  accent: string;
  /**
   * From `shared/players.ts`, never written out here — the card promises a range
   * and a referee enforces one, and while they were two literals they could drift.
   */
  players: PlayerLimits;
  /** Human-readable, e.g. "1–2 min". */
  duration: string;
  /**
   * Hide the "N players" half of the card's meta line. Defaults to shown.
   * For a card that is not itself a real game — Random Game redirects into
   * whichever built game gets rolled, so its own `players` range (kept for
   * the hub's player-count filter, `HubFilters.tsx`) describes nothing about
   * what happens when it's tapped.
   */
  showPlayerCount?: boolean;
  /** Same, for the duration half. */
  showDuration?: boolean;
  inputs: GameInput[];
  /** 1–3 of `GameTag`. See that type's own comment. */
  tags: GameTag[];
  modes: GameMode[];
  /**
   * French text overriding the fields above, where translated. A missing field
   * falls back to English — a game can ship with only some fields translated.
   * `rules` entries reuse `HowToPlay.tsx`'s `{{#hex|word}}` colour markup verbatim,
   * the same as the English rules. Spec: docs/specs/i18n.md
   */
  fr?: {
    title?: string;
    pitch?: string;
    concept?: string;
    rules?: string[];
    art?: { alt?: string };
  };
  /**
   * The one switch that decides how a game appears in the catalogue.
   *
   * | Value | Badge | Tappable | Order |
   * | --- | --- | --- | --- |
   * | `live` | none | yes | first |
   * | `soon` | **SOON**, quiet | **no**, and dimmed | last |
   *
   * **This says whether a game EXISTS, not how it is being sold.** There used to be a
   * third value, `new`, and it was a mistake: the NEW badge is a merchandising
   * decision that changes every few weeks, and baking it into a bundle meant the only
   * way to take it off a card was a deploy. Worse, `cardState` OR'd it with the flag,
   * so the admin's NEW toggle silently did nothing for exactly the games that had it.
   *
   * NEW now lives entirely in `flags.json`, set from the admin centre. A game's actual
   * maturity is not lost either — it stays in its spec's Status row, which is where an
   * honest "playable but the balance numbers are guesses" belongs, and which nobody
   * browsing the hub is reading.
   *
   * Adding a value means: this table, the badge in `GameCardTile`, an
   * `ORDER` entry in `games/registry.ts`, and a `.game-card__badge--<value>` rule.
   */
  status: 'live' | 'soon';
};
