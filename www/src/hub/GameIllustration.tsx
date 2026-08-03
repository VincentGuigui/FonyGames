import type { JSX } from 'preact';
import type { GameMotif } from '../core/types';

/**
 * PLACEHOLDER ART. Real illustrations are milestone M6 (docs/roadmap.md).
 *
 * These follow the house style in docs/design/ui-guidelines.md §6 — flat, bold
 * shapes, thick outlines, readable at 160px — and share one visual language
 * (the phone) so the grid looks like one product rather than nine.
 */

const W = 120;
const H = 90;

function Phone(props: {
  x: number;
  y: number;
  rotate?: number;
  fill?: string;
}): JSX.Element {
  const { x, y, rotate = 0, fill = '#10121a' } = props;
  return (
    <g transform={`rotate(${rotate} ${x + 11} ${y + 19})`}>
      <rect
        x={x}
        y={y}
        width={22}
        height={38}
        rx={5}
        fill={fill}
        stroke="currentColor"
        stroke-width={3}
      />
    </g>
  );
}

function motifBody(motif: GameMotif): JSX.Element {
  switch (motif) {
    case 'bump':
      return (
        <>
          <Phone x={26} y={26} rotate={-14} />
          <Phone x={72} y={26} rotate={14} />
          <g stroke="currentColor" stroke-width={4} stroke-linecap="round">
            <path d="M60 30 L60 22" />
            <path d="M52 36 L45 31" />
            <path d="M68 36 L75 31" />
          </g>
          <circle cx={60} cy={46} r={7} fill="currentColor" />
        </>
      );

    case 'shake':
      return (
        <>
          <Phone x={49} y={26} />
          <g stroke="currentColor" stroke-width={4} stroke-linecap="round">
            <path d="M34 38 L26 38" />
            <path d="M34 50 L22 50" />
            <path d="M86 38 L94 38" />
            <path d="M86 50 L98 50" />
          </g>
        </>
      );

    case 'tilt':
      return (
        <>
          <circle
            cx={60}
            cy={45}
            r={31}
            fill="none"
            stroke="currentColor"
            stroke-width={3}
            stroke-dasharray="7 6"
          />
          <Phone x={49} y={26} rotate={28} />
        </>
      );

    case 'steady':
      return (
        <>
          <Phone x={49} y={24} />
          <circle cx={60} cy={43} r={13} fill="none" stroke="currentColor" stroke-width={3} />
          <circle cx={60} cy={43} r={4} fill="currentColor" />
          <path
            d="M40 74 h40"
            stroke="currentColor"
            stroke-width={4}
            stroke-linecap="round"
          />
        </>
      );

    case 'tap':
      // The archer's target the game actually shows, plus a thumb coming in at
      // it. The old motif was expanding rings — which read as a tap *ripple*,
      // the thing that happens after, rather than the thing you are aiming at.
      return (
        <>
          {/* Rings outside in, in the archery colours the board uses. */}
          <circle cx={56} cy={44} r={30} fill="#f4f1e8" />
          <circle cx={56} cy={44} r={30} fill="none" stroke="currentColor" stroke-width={3} />
          <circle cx={56} cy={44} r={23} fill="#14161c" />
          <circle cx={56} cy={44} r={16} fill="#1f6feb" />
          <circle cx={56} cy={44} r={10} fill="#d92d20" />
          <circle cx={56} cy={44} r={4.5} fill="#f5c518" />

          {/*
            A finger coming in at it from the corner. Drawn as a rounded digit
            with a knuckle and a nail — the first attempt was one wedge plus an
            ellipse, which read as the tail of a speech bubble.
          */}
          <g transform="rotate(-38 96 68)">
            <rect x={84} y={58} width={34} height={20} rx={10} fill="currentColor" />
            <circle cx={116} cy={68} r={12} fill="currentColor" />
            <ellipse cx={90} cy={68} rx={5} ry={7} fill="#10121a" opacity={0.3} />
          </g>
        </>
      );

    case 'ghost':
      return (
        <>
          <path
            d="M42 72 V46 a18 18 0 0 1 36 0 v26 l-7-6 -6 6 -6-6 -6 6 -5-5 z"
            fill="currentColor"
          />
          {/* Eyes must be the card surface, not the accent — the ghost body
              is already the accent, so accent-on-accent is invisible. */}
          <circle cx={53} cy={48} r={4} fill="var(--color-surface-2)" />
          <circle cx={67} cy={48} r={4} fill="var(--color-surface-2)" />
          <path
            d="M60 30 V18"
            stroke="currentColor"
            stroke-width={4}
            stroke-linecap="round"
            stroke-dasharray="4 5"
          />
        </>
      );

    case 'zone':
      return (
        <g stroke="currentColor" stroke-width={3}>
          <rect x={26} y={22} width={22} height={22} fill="currentColor" />
          <rect x={49} y={22} width={22} height={22} fill="none" />
          <rect x={72} y={22} width={22} height={22} fill="none" />
          <rect x={26} y={45} width={22} height={22} fill="none" />
          <rect x={49} y={45} width={22} height={22} fill="currentColor" />
          <rect x={72} y={45} width={22} height={22} fill="currentColor" />
        </g>
      );

    case 'compass':
      return (
        <>
          <circle cx={60} cy={45} r={29} fill="none" stroke="currentColor" stroke-width={3} />
          <path d="M60 22 L71 57 L60 50 L49 57 Z" fill="currentColor" />
        </>
      );

    case 'scream':
      return (
        <>
          <Phone x={36} y={26} />
          <g
            fill="none"
            stroke="currentColor"
            stroke-width={4}
            stroke-linecap="round"
          >
            <path d="M70 36 a10 10 0 0 1 0 18" />
            <path d="M78 29 a20 20 0 0 1 0 32" />
            <path d="M86 22 a30 30 0 0 1 0 46" />
          </g>
        </>
      );

    case 'spill':
      // Four phones flat in a square, each with its top edge pointing at the
      // middle — the arrangement *is* the game — with a drop arcing between them.
      //
      // The phones are scaled down **harder than the drop** so the drop is the
      // subject. Scaled together they filled the box and the water, which is what
      // the game is about, was a detail lost in the middle of them.
      return (
        <>
          {/* The square of phones, kept a clean square so the arrangement still
              reads — just small, with the drop outside it rather than over it. */}
          <g transform="translate(46 53) scale(0.5) translate(-60 -45)">
            <Phone x={49} y={-4} rotate={180} />
            <Phone x={49} y={56} />
            <Phone x={4} y={26} rotate={90} />
            <Phone x={94} y={26} rotate={-90} />
          </g>

          {/* The arc it travels, then the drop, at full size and clear of them. */}
          <path
            d="M50 64 Q64 58 76 48"
            fill="none"
            stroke="currentColor"
            stroke-width={4}
            stroke-dasharray="6 7"
            stroke-linecap="round"
            opacity={0.7}
          />
          <path
            d="M92 12 c10 14 16 21 16 28 a16 16 0 0 1-32 0 c0-7 6-14 16-28 Z"
            fill="currentColor"
          />
          {/* A highlight, so a big flat teardrop still reads as liquid. */}
          <ellipse cx={86} cy={38} rx={4} ry={5.5} fill="#10121a" opacity={0.32} />
        </>
      );

    case 'goat':
      // A goat sailing in over the fence towards a row of cabbages. The fence
      // sits behind, the cabbages in front on the ground, so the depth reads.
      return (
        <>
          <g stroke="currentColor" stroke-width={4} stroke-linecap="round">
            <path d="M10 54 L110 54" />
            <path d="M26 44 L26 60" />
            <path d="M60 44 L60 60" />
            <path d="M94 44 L94 60" />
          </g>
          {/* Cabbages, not dots: leaf lobes and a curled heart, matching the
              board (games/goat-siege/render.ts). Plain circles read as tokens. */}
          <g>
            {[
              [22, 72, 9],
              [45, 74, 10],
              [68, 72, 9],
              [91, 74, 10],
            ].map(([cx, cy, r]) => (
              <g key={`${cx}`} transform={`translate(${cx} ${cy})`}>
                {[0, 1, 2, 3, 4].map((i) => {
                  const a = -Math.PI / 2 + (i / 5) * Math.PI * 2 + 0.3;
                  return (
                    <ellipse
                      key={i}
                      cx={Math.cos(a) * r! * 0.5}
                      cy={Math.sin(a) * r! * 0.4}
                      rx={r! * 0.6}
                      ry={r! * 0.42}
                      transform={`rotate(${(a * 180) / Math.PI})`}
                      fill="currentColor"
                      opacity={0.55}
                    />
                  );
                })}
                <ellipse rx={r! * 0.78} ry={r! * 0.72} fill="currentColor" />
                {/* The heart, as a small ring rather than a curl: at this size a
                    single curved vein read as a crescent stuck on the front. */}
                <circle r={r! * 0.3} fill="none" stroke="#10121a" stroke-width={1.6} opacity={0.4} />
              </g>
            ))}
          </g>
          {/*
            Goat in side profile, as one bold silhouette rather than stick
            lines: at 160px a stroked skeleton reads as a spider, and the house
            style is flat shapes anyway (docs/design/ui-guidelines.md §6).
          */}
          <g fill="currentColor">
            {/* Legs, tucked as if mid-jump. */}
            <rect x={30} y={30} width={5} height={12} rx={2.5} />
            <rect x={39} y={32} width={5} height={11} rx={2.5} />
            <rect x={49} y={31} width={5} height={12} rx={2.5} />
            <rect x={57} y={30} width={5} height={11} rx={2.5} />
            <ellipse cx={45} cy={24} rx={19} ry={10} />
            {/* Tail. */}
            <path d="M27 18 L20 10 L28 22 Z" />
            {/* Neck and head. */}
            <path d="M56 20 L66 12 L72 18 L62 26 Z" />
            <ellipse cx={70} cy={15} rx={9} ry={6.5} />
            {/* Beard — the one shape that says goat and not sheep. */}
            <path d="M70 20 L67 30 L74 21 Z" />
          </g>
          {/* Horns sweep back over the neck. */}
          <g fill="none" stroke="currentColor" stroke-width={3.5} stroke-linecap="round">
            <path d="M67 9 Q62 2 55 4" />
            <path d="M74 9 Q70 1 62 2" />
          </g>
          <circle cx={74} cy={13} r={2} fill="#10121a" />
        </>
      );

    case 'sling':
      // The two halves of one board, the join between them broken by the gap,
      // your band stretched into a V and a puck already through it.
      //
      // Not drawn with the shared `Phone` glyph: two portrait phones nose to nose
      // is a tall, narrow arrangement, and at card size it came out as two flat
      // bars with a dot in one of them. These are the two *halves of the board*,
      // proportioned to fill the box — the true phone geometry is taught by the
      // lobby's diagram, where it can be read properly.
      return (
        <>
          <g fill="#10121a" stroke="currentColor" stroke-width={3}>
            <rect x={38} y={5} width={44} height={36} rx={6} />
            <rect x={38} y={49} width={44} height={36} rx={6} />
          </g>

          {/* The join, with the gap as a break in it. */}
          <g stroke="currentColor" stroke-width={4} stroke-linecap="round">
            <path d="M36 45 L52 45" />
            <path d="M68 45 L84 45" />
          </g>

          {/*
            Both bands, each with its two posts. The posts matter: without them a
            plain line at the top of a rounded rect reads as a phone's speaker
            grille, and a bare V reads as a downward arrow rather than as
            something under tension.
          */}
          <g fill="currentColor">
            <circle cx={44} cy={14} r={2.5} />
            <circle cx={76} cy={14} r={2.5} />
            <circle cx={44} cy={66} r={2.5} />
            <circle cx={76} cy={66} r={2.5} />
          </g>
          <path d="M44 14 L76 14" stroke="currentColor" stroke-width={2.5} stroke-linecap="round" />

          {/* Yours, pulled deep — the moment before a shot. */}
          <path
            d="M44 66 L60 79 L76 66"
            fill="none"
            stroke="currentColor"
            stroke-width={3.5}
            stroke-linecap="round"
            stroke-linejoin="round"
          />

          {/*
            The puck caught **in** the gap, mid-crossing, rather than past it with
            a trail behind. A trail long enough to read had to start inside the V,
            and dashes-into-a-V is a downward arrow, which is the opposite of what
            is happening. Sitting in the break says the same thing with no arrow.
          */}
          <path
            d="M60 63 L60 54"
            fill="none"
            stroke="currentColor"
            stroke-width={2.5}
            stroke-dasharray="4 5"
            stroke-linecap="round"
          />
          <circle cx={60} cy={45} r={7} fill="#f4f1e8" />
          <circle cx={60} cy={45} r={3} fill="#10121a" />
        </>
      );
  }
}

export function GameIllustration({
  motif,
  accent,
}: {
  motif: GameMotif;
  accent: string;
}): JSX.Element {
  return (
    <svg
      class="game-illustration"
      viewBox={`0 0 ${W} ${H}`}
      role="presentation"
      aria-hidden="true"
      style={{ color: accent } as JSX.CSSProperties}
    >
      <rect width={W} height={H} fill={accent} opacity={0.14} />
      {motifBody(motif)}
    </svg>
  );
}
