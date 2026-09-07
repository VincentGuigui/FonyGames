import { useCallback, useMemo, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { COLOR_SECTOR_MAX } from '../../../../shared/protocol';
import { saturationSteps, type Rgb, type Rung } from '../../../../shared/color';
import { WHEEL_HUB, continuousAt, positionOf, ringBand, sectorAt, sectorsFor } from './wheel';

/**
 * The wheel a thumb drags. Spec: docs/specs/games/color-match.md §4.1, §4.2
 *
 * SVG rather than canvas: the wedges are a few dozen paths that change once a
 * level rather than sixty times a second, and the disc has to scale to any
 * board width without a resize observer. Every number here comes from
 * `wheel.ts`, which is DOM-free and tested — this file owns pixels and pointer
 * events and nothing else.
 */

const R = 50;

function css(rgb: Rgb): string {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

/** One wedge, as an SVG path. Angles run clockwise from twelve o'clock, which
 *  is the convention `sectorAt` hit-tests against. */
function wedge(r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number): string => `${(Math.sin(a) * r * R).toFixed(3)} ${(-Math.cos(a) * r * R).toFixed(3)}`;
  const big = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(r0, a0)} L ${p(r1, a0)} A ${(r1 * R).toFixed(3)} ${(r1 * R).toFixed(3)} 0 ${big} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${(r0 * R).toFixed(3)} ${(r0 * R).toFixed(3)} 0 ${big} 0 ${p(r0, a0)} Z`;
}

/** The continuous disc's own hue ring, as wedges at full saturation. Built
 *  once at module load — it never depends on the rung, only the snap does.
 *  A wedge is 7.5 degrees, which is under a millimetre of arc at the rim on a
 *  phone: fine enough that the seams do not read as bands. */
const HUE_WEDGES = Array.from({ length: 48 }, (_, i) => {
  const a0 = (i / 48) * Math.PI * 2;
  const a1 = ((i + 1) / 48) * Math.PI * 2;
  // Overlap each wedge into the next by a hair so antialiasing cannot leave a
  // dark seam between them.
  return { a0, a1: a1 + 0.004, fill: css(hueAt(((i + 0.5) / 48) * 360)) };
});

/** Full-saturation, full-value RGB for a hue — the rim of the disc. Mirrors
 *  `continuousAt`'s own conversion; the snap it applies afterwards is the
 *  rung's business, not the backdrop's. */
function hueAt(h: number): Rgb {
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((hp % 2) - 1);
  const [r, g, b] = hp < 1 ? [1, x, 0] : hp < 2 ? [x, 1, 0] : hp < 3 ? [0, 1, x] : hp < 4 ? [0, x, 1] : hp < 5 ? [x, 0, 1] : [1, 0, x];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

type Props = {
  rung: Rung;
  /** The colour currently picked — where the cursor is drawn. */
  value: Rgb;
  onPick: (rgb: Rgb) => void;
  /** Picking is closed during the reveal; the wheel stays on screen, inert. */
  disabled: boolean;
  label: string;
};

export function ColorWheel({ rung, value, onPick, disabled, label }: Props): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const sectors = useMemo(() => sectorsFor(rung, COLOR_SECTOR_MAX), [rung]);
  const wedges = sectors.length > 0;

  /** Pointer position as offsets from the centre, in units of the radius. */
  const local = useCallback((e: PointerEvent): { nx: number; ny: number } | null => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return null;
    return { nx: (e.clientX - (box.left + box.width / 2)) / (box.width / 2), ny: (e.clientY - (box.top + box.height / 2)) / (box.height / 2) };
  }, []);

  const handle = useCallback(
    (e: PointerEvent): void => {
      if (disabled) return;
      const at = local(e);
      if (!at) return;
      if (wedges) {
        const hit = sectorAt(sectors, at.nx, at.ny);
        if (hit) onPick(hit.rgb);
        return;
      }
      const rgb = continuousAt(rung, at.nx, at.ny);
      if (rgb) onPick(rgb);
    },
    [disabled, local, wedges, sectors, rung, onPick],
  );

  /* One geometry for both presentations, so the cursor is placed by the same
     maths that decides what a tap picks — and is simply absent while the pick
     is still the neutral grey, which no rung offers. */
  const cursor = positionOf(value, rung);
  const rings = useMemo(() => saturationSteps(rung.sats).map((s, i) => ({ s, ...ringBand(rung.sats, i) })), [rung]);

  return (
    <svg
      ref={svgRef}
      class={`cmatch__wheel${disabled ? ' cmatch__wheel--locked' : ''}`}
      viewBox={`${-R - 4} ${-R - 4} ${(R + 4) * 2} ${(R + 4) * 2}`}
      role="group"
      aria-label={label}
      onPointerDown={(e) => {
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        handle(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 0) return;
        handle(e);
      }}
    >
      {wedges ? (
        sectors.map((s) => (
          <path key={s.rgb.join(',')} d={wedge(s.r0, s.r1, s.a0, s.a1)} fill={css(s.rgb)} stroke="#0B0910" stroke-width="0.6" />
        ))
      ) : (
        <>
          {/* Hue around, saturation outward. Drawn as wedges of the SAME
              geometry `continuousAt` reads rather than as a gradient: a linear
              gradient across a disc does not put a hue where the angle says it
              is, so the colour under the thumb would not be the colour picked.
              48 paths, rebuilt only when the rung changes. */}
          {HUE_WEDGES.map((w) => (
            <path key={w.a0} d={wedge(0, 1, w.a0, w.a1)} fill={w.fill} />
          ))}
          {/* Saturation, as one white ring per step rather than a smooth
              gradient. White at opacity `1 - s` over a pure hue IS
              `hsv(h, s, 1)`, so each band paints exactly the saturation the
              hit test will return there — and a rung with a single step gets
              no bands at all, which is the outer ring and nothing else. */}
          {rings.map((band) => (
            band.s >= 1 ? null : (
              <circle
                key={band.s}
                r={((band.r0 + band.r1) / 2) * R}
                fill="none"
                stroke="#FFFFFF"
                stroke-width={(band.r1 - band.r0) * R}
                opacity={1 - band.s}
              />
            )
          ))}
        </>
      )}

      {/* The hub: the current pick, big enough to judge against the target. */}
      <circle r={WHEEL_HUB * R} fill={css(value)} stroke="#0B0910" stroke-width="1.4" />

      {/* The cursor — a two-tone ring, because a dot in the colour you picked
          is invisible against the colour you picked (spec §4.1). */}
      {cursor && (
        <g transform={`translate(${(cursor.nx * R).toFixed(2)} ${(cursor.ny * R).toFixed(2)})`}>
          <circle r="6.2" fill="none" stroke="#0B0910" stroke-width="3.4" />
          <circle r="6.2" fill="none" stroke="#FFFFFF" stroke-width="1.8" />
        </g>
      )}
    </svg>
  );
}
