/**
 * Flat-recolour a raster source. Contract: docs/design/illustrations.md §4
 *
 * `source-in` keeps the destination's own alpha (the sprite's silhouette) and
 * replaces every opaque pixel's colour with whatever is drawn next — so
 * drawing the sprite, then filling the whole canvas in one flat colour under
 * that composite mode, recolours the shape without redrawing it stroke by
 * stroke. This is the one sanctioned way to change a sprite's fill (the
 * "state-driven drawing cannot be a static sprite" rule is about a fill that
 * changes over *time* or with the physics; a colour fixed to a player's own
 * avatar for the whole match is neither).
 */
export function tinted(source: CanvasImageSource, width: number, height: number, color: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;
  ctx.drawImage(source, 0, 0, width, height);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, width, height);
  return canvas;
}
