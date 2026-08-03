import type { JSX } from 'preact';
import { GAP_FRACTION } from './physics';

/**
 * How to lay the two phones down. Spec: docs/specs/games/sling-puck.md §8
 *
 * The one physical instruction the game depends on and cannot check: **top edge
 * to top edge**. Get it wrong and the gap is not where the drawing says it is,
 * so this is a diagram rather than a sentence — the same reasoning as Spill's
 * seat map, for the same reason.
 *
 * Drawn from the side of the table, with "you" nearest, because that is the view
 * the player actually has of the arrangement.
 */
export function HeadToHead({ size = 210 }: { size?: number }): JSX.Element {
  const w = size;
  const h = size * 0.86;

  // Two phones stacked, "yours" at the bottom, meeting in the middle.
  const pw = w * 0.34;
  const ph = h * 0.4;
  const cx = w / 2;
  const midY = h / 2;
  const gapW = pw * GAP_FRACTION;

  const phone = (top: number, flip: boolean): JSX.Element => (
    <g>
      <rect
        x={cx - pw / 2}
        y={top}
        width={pw}
        height={ph}
        rx={pw * 0.12}
        fill="rgb(255 255 255 / 6%)"
        stroke="currentColor"
        stroke-width="1.5"
      />
      {/* The band, across the far end from the join — the end the player sits at. */}
      <line
        x1={cx - pw * 0.4}
        y1={flip ? top + ph * 0.24 : top + ph * 0.76}
        x2={cx + pw * 0.4}
        y2={flip ? top + ph * 0.24 : top + ph * 0.76}
        stroke="#FB7185"
        stroke-width="2"
        stroke-linecap="round"
      />
    </g>
  );

  return (
    <svg
      class="h2h"
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      role="img"
      aria-label="Two phones laid on a table, top edge to top edge, with the gap where they meet"
    >
      {/* The join, and the gap in it — the only way a puck gets across. */}
      <line
        x1={cx - pw / 2}
        y1={midY}
        x2={cx - gapW / 2}
        y2={midY}
        stroke="currentColor"
        stroke-width="3"
      />
      <line
        x1={cx + gapW / 2}
        y1={midY}
        x2={cx + pw / 2}
        y2={midY}
        stroke="currentColor"
        stroke-width="3"
      />

      {phone(midY - ph - 2, true)}
      {phone(midY + 2, false)}

      {/* A puck on its way through the gap. */}
      <circle cx={cx} cy={midY - ph * 0.18} r={pw * 0.07} fill="#f4f1e8" />
      <path
        d={`M ${cx} ${midY + ph * 0.2} L ${cx} ${midY - ph * 0.05}`}
        stroke="#FB7185"
        stroke-width="1.5"
        stroke-dasharray="3 3"
        fill="none"
      />

      <text x={cx} y={midY + ph + 16} class="h2h__label" text-anchor="middle">
        you
      </text>
      <text x={cx} y={midY - ph - 8} class="h2h__label" text-anchor="middle">
        them
      </text>
    </svg>
  );
}
