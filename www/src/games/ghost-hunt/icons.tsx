import type { JSX } from 'preact';

/**
 * Ghost Hunt's four control icons, drawn inline.
 *
 * Inline SVG rather than files in `art/`, and rather than emoji. Emoji were tried first
 * and are wrong twice over: 📱 and 👆 render as tofu boxes on devices missing the glyph
 * (docs/design/illustrations.md, and the hub's card meta says the same), and neither of
 * them can show the thing that actually distinguishes these two modes — the *movement*.
 * A phone and a finger both mean "input"; a phone with arrows curving around it means
 * "turn this", and a finger with arrows means "drag".
 *
 * They inherit `currentColor` and size from the font, so a button that turns accent
 * coloured takes its icon with it.
 */

const BASE = {
  viewBox: '0 0 24 24',
  width: '24',
  height: '24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.6,
  'stroke-linecap': 'round' as const,
  'stroke-linejoin': 'round' as const,
  'aria-hidden': true,
  focusable: 'false',
};

/**
 * Turn the phone: a handset seen at a slight angle, with four arrows curving around it.
 *
 * The perspective is the point. A flat rectangle reads as "a phone"; a skewed one reads
 * as a phone being *held and rotated*, which is the gesture this mode is asking for. The
 * skew is a plain transform on the body rather than a hand-drawn trapezoid, so the corner
 * radius stays even.
 */
export function TurnPhoneIcon(): JSX.Element {
  return (
    <svg {...BASE}>
      <g transform="rotate(-16 12 12) skewY(-6)">
        <rect x="8.4" y="5.6" width="7.2" height="12.8" rx="1.6" />
        <line x1="10.6" y1="7.6" x2="13.4" y2="7.6" />
        <circle cx="12" cy="16.3" r="0.6" fill="currentColor" stroke="none" />
      </g>
      {/* Four arcs around it, each with a head, so the rotation reads in both axes. */}
      <path d="M4.6 8.6A9 9 0 0 1 8.8 4.3" />
      <path d="M8.8 4.3 6.6 4.1M8.8 4.3 8.9 6.4" />
      <path d="M19.4 15.4A9 9 0 0 1 15.2 19.7" />
      <path d="M15.2 19.7 17.4 19.9M15.2 19.7 15.1 17.6" />
      <path d="M19.4 8.6A9 9 0 0 0 15.2 4.3" />
      <path d="M15.2 4.3 15.1 6.4M15.2 4.3 17.4 4.1" />
      <path d="M4.6 15.4A9 9 0 0 0 8.8 19.7" />
      <path d="M8.8 19.7 8.9 17.6M8.8 19.7 6.6 19.9" />
    </svg>
  );
}

/** Drag with a finger: a pointing hand with four straight arrows around it. */
export function DragFingerIcon(): JSX.Element {
  return (
    <svg {...BASE}>
      {/* The hand: one extended finger, a fist below it. */}
      <path d="M12 13.2V7.4a1.15 1.15 0 0 1 2.3 0v5.1" />
      <path d="M14.3 11.6a1.1 1.1 0 0 1 2.2 0v1.1" />
      <path d="M16.5 12.2a1.1 1.1 0 0 1 2.2 0v3.1a4.4 4.4 0 0 1-4.4 4.4h-1.6a4 4 0 0 1-3.1-1.5l-2-2.5a1.15 1.15 0 0 1 1.7-1.5l1.6 1.5" />
      {/* Four arrows, one per direction, clear of the hand. */}
      <path d="M12 5.2 12 2.4M12 2.4 10.9 3.6M12 2.4 13.1 3.6" />
      <path d="M6.6 12 3.8 12M3.8 12 5 10.9M3.8 12 5 13.1" />
      <path d="M20.4 8.6 22.6 8.6M22.6 8.6 21.4 7.5M22.6 8.6 21.4 9.7" />
      <path d="M5.4 19.4 3.6 21.2M3.6 21.2 3.6 19.6M3.6 21.2 5.2 21.2" />
    </svg>
  );
}

/** The camera route: a camera body, seen head on. */
export function CameraIcon(): JSX.Element {
  return (
    <svg {...BASE}>
      <path d="M3 8.4h3.2l1.5-2.2h8.6l1.5 2.2H21v10.2H3z" />
      <circle cx="12" cy="13.2" r="3.4" />
    </svg>
  );
}

/**
 * The virtual room: a framed picture, with the horizon and hills that say "a place".
 *
 * A panorama rather than a generic image glyph — what this mode offers is somewhere to
 * stand, not a file.
 */
export function RoomImageIcon(): JSX.Element {
  return (
    <svg {...BASE}>
      <rect x="2.6" y="5.2" width="18.8" height="13.6" rx="1.8" />
      <circle cx="8.2" cy="9.6" r="1.4" />
      <path d="M2.6 16.2 8 11.6l3.6 3.1 3.2-2.6 6.6 4.9" />
    </svg>
  );
}
