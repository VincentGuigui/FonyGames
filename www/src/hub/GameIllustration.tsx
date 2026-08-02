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
      return (
        <>
          <Phone x={49} y={26} />
          <circle cx={60} cy={45} r={8} fill="currentColor" />
          <circle
            cx={60}
            cy={45}
            r={16}
            fill="none"
            stroke="currentColor"
            stroke-width={3}
            opacity={0.6}
          />
          <circle
            cx={60}
            cy={45}
            r={25}
            fill="none"
            stroke="currentColor"
            stroke-width={3}
            opacity={0.3}
          />
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
