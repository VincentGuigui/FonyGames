import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import qrcode from 'qrcode-generator';

/**
 * QR of the join link, rendered as one SVG path so it scales cleanly and costs
 * no image request. Scanned with the OS camera app — we never ask for camera
 * permission ourselves (docs/specs/join.md §1).
 */
export function QrCode({
  value,
  size = 200,
}: {
  value: string;
  size?: number;
}): JSX.Element {
  const { path, cells } = useMemo(() => {
    // typeNumber 0 = auto-size. 'M' tolerates ~15% damage, which is the right
    // trade for a code being scanned off a phone screen at an angle.
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();

    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) d += `M${col} ${row}h1v1h-1z`;
      }
    }
    return { path: d, cells: n };
  }, [value]);

  // A quiet zone is part of the spec, not decoration — scanners need it.
  const quiet = 2;
  const span = cells + quiet * 2;

  return (
    <svg
      class="qr"
      width={size}
      height={size}
      viewBox={`0 0 ${span} ${span}`}
      role="img"
      aria-label="QR code to join this room"
      shape-rendering="crispEdges"
    >
      <rect width={span} height={span} fill="#ffffff" />
      <g transform={`translate(${quiet} ${quiet})`} fill="#000000">
        <path d={path} />
      </g>
    </svg>
  );
}
