import type { JSX } from 'preact';
import type { GameArt } from '../core/types';

/**
 * A card's illustration. Spec: docs/specs/hub.md §2 · style: ui-guidelines.md §6
 *
 * An `<img>`, not inline SVG, and that is the whole point: inline art is JavaScript,
 * and illustrations are budgeted *out* of the hub's payload
 * (docs/architecture.md §4). This file used to be ~410 lines of hand-written paths —
 * 54% of the hub chunk — and is now a wrapper around a file per game.
 *
 * The accent tint is painted **here** rather than inside the SVG so that one paint
 * does two jobs: it is the placeholder that holds the space before the file arrives
 * (hub.md §2 — the grid must not jump) and the backdrop after, because the art files
 * are transparent. Painted in both places it would double the moment the image
 * loaded.
 *
 * See docs/design/illustrations.md for why the files cannot use `currentColor`.
 */
export function GameIllustration({
  art,
  accent,
}: {
  art: GameArt;
  accent: string;
}): JSX.Element {
  return (
    <img
      class="game-illustration"
      src={art.src}
      alt={art.alt}
      // Intrinsic ratio, so the box is reserved before the file arrives even if the
      // stylesheet is late. hub.css states it again as `aspect-ratio`.
      width={120}
      height={90}
      loading="lazy"
      decoding="async"
      // `24` is 14% alpha — the same tint the old inline <rect> painted. Eight-digit
      // hex rather than color-mix(), which wants Safari 16.2, and the older
      // mid-range phone in docs/testing.md §3 is the point of this project.
      style={{ backgroundColor: `${accent}24` } as JSX.CSSProperties}
    />
  );
}
