import type { PlayerLimits } from '../../../shared/players';

/** Input a game relies on. Drives the icons on the hub card. */
export type GameInput =
  | 'touch'
  | 'motion'
  | 'orientation'
  | 'gps'
  | 'compass'
  | 'mic';

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
  inputs: GameInput[];
  modes: GameMode[];
  /**
   * The one switch that decides how a game appears in the catalogue.
   *
   * | Value | Badge | Tappable | Order |
   * | --- | --- | --- | --- |
   * | `live` | none | yes | first |
   * | `new` | **NEW**, in the accent | yes | after `live` |
   * | `soon` | **SOON**, quiet | **no**, and dimmed | last |
   *
   * `new` replaced `beta`. Same switch, different promise: the hub's job is to sell a
   * game, and "beta" reads as *might be broken* where "new" reads as *look at this*.
   * A game's actual maturity is not lost — it stays in its spec's Status row, which is
   * where an honest "playable but the balance numbers are guesses" belongs, and which
   * nobody browsing the hub is reading.
   *
   * Adding a value means: this table, the badge in `GameCardTile`, an
   * `ORDER` entry in `games/registry.ts`, and a `.game-card__badge--<value>` rule.
   */
  status: 'live' | 'new' | 'soon';
};
