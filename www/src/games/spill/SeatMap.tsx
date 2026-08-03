import type { JSX } from 'preact';
import type { Player, PlayerId } from '../../../../shared/protocol';
import { screenAngleTo, seatLayout } from '../../../../shared/spillGeometry';

/**
 * Where to put your phone, drawn **from your own point of view**.
 *
 * This is the whole trick that makes Spill work without a compass
 * (docs/specs/games/spill.md §2): everyone lays their phone flat with its top
 * edge pointing at the middle of the table, so a direction on your screen is a
 * direction in the room.
 *
 * Because it is drawn from your seat, the diagram is also the aim guide — a
 * neighbour shown up and to the left is a neighbour you hit by flicking up and
 * to the left. Rotating it per player is not a nicety; a shared top-down map
 * would be wrong for three players out of four.
 */
export function SeatMap({
  seats,
  players,
  me,
  out = [],
  size = 200,
}: {
  seats: PlayerId[];
  players: Player[];
  me: PlayerId;
  out?: PlayerId[];
  size?: number;
}): JSX.Element | null {
  const n = seats.length;
  const mine = seats.indexOf(me);
  if (n < 2 || mine < 0) return null;

  // Radius leaves room for the name under the lowest phone: our own seat sits at
  // c + r, the glyph reaches 20 below that and the label 30, so c + r + 30 must
  // stay inside the box or the label is clipped at small sizes.
  const r = size * 0.3;
  const c = size / 2;
  const byId = new Map(players.map((p) => [p.id, p]));

  // True relative positions, rotated so our own seat is at the bottom facing
  // up — which is how the phone in your hand ends up once you lay it down.
  const layout = seatLayout(mine, n);
  const at = (seat: number): { x: number; y: number } => {
    const p = layout[seat] ?? { x: 0, y: 1 };
    return { x: c + p.x * r, y: c + p.y * r };
  };

  return (
    <svg
      class="seatmap"
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      role="img"
      aria-label={describe(seats, byId, me, mine, n)}
    >
      <circle cx={c} cy={c} r={r * 0.62} class="seatmap__table" />
      {seats.map((id, seat) => {
        const p = at(seat);
        const person = byId.get(id);
        const gone = out.includes(id);
        // Each glyph is turned so its own top edge faces the middle — the
        // diagram would otherwise contradict the one instruction it exists to
        // give. Only the phone turns; the avatar and name stay upright.
        const spin = (Math.atan2(-(layout[seat]?.x ?? 0), layout[seat]?.y ?? 1) * 180) / Math.PI;
        return (
          <g key={id} class={`seatmap__seat ${seat === mine ? 'is-me' : ''} ${gone ? 'is-out' : ''}`}>
            <g transform={`rotate(${spin.toFixed(1)} ${p.x} ${p.y})`}>
              {/* A rounded rect, not a dot: it reads as a phone, and the notch
                  marks the top edge. */}
              <rect x={p.x - 13} y={p.y - 20} width={26} height={40} rx={5} />
              <line x1={p.x} y1={p.y - 20} x2={p.x} y2={p.y - 13} class="seatmap__top" />
            </g>
            <text x={p.x} y={p.y + 6} class="seatmap__face">
              {gone ? '·' : (person?.avatar ?? '?')}
            </text>
            <text x={p.x} y={p.y + 30} class="seatmap__name">
              {seat === mine ? 'you' : (person?.name ?? '')}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** The same information for a screen reader, since the SVG carries it visually. */
function describe(
  seats: PlayerId[],
  byId: Map<PlayerId, Player>,
  me: PlayerId,
  mine: number,
  n: number,
): string {
  const parts = seats
    .map((id, seat) => {
      if (id === me) return null;
      const name = byId.get(id)?.name ?? 'someone';
      return `${name} is ${clockwords(screenAngleTo(mine, seat, n))}`;
    })
    .filter(Boolean);
  return `Table layout. ${parts.join('; ')}.`;
}

function clockwords(angle: number): string {
  const deg = (angle * 180) / Math.PI;
  if (Math.abs(deg) < 22) return 'straight ahead';
  if (Math.abs(deg) > 158) return 'behind you';
  const side = deg > 0 ? 'right' : 'left';
  return Math.abs(deg) > 68 ? `to your ${side}` : `ahead and to your ${side}`;
}
