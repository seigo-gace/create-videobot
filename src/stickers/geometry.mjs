/**
 * Shared, deterministic geometry for static/video sticker and emoji conversion.
 * Dimensions are computed here; actual transcoding remains the media worker's
 * responsibility. Never crop or stretch the source artwork.
 */
function positiveInt(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name + ' must be a positive safe integer');
  return value;
}

export function stickerGeometry(width, height, kind = 'sticker') {
  const w = positiveInt(width, 'width');
  const h = positiveInt(height, 'height');
  if (kind !== 'sticker' && kind !== 'emoji') throw new RangeError('unsupported output kind');
  const side = kind === 'sticker' ? 512 : 100;
  const long = Math.max(w, h);
  // Compute the short dimension from the long dimension to ensure the output
  // long side is EXACTLY the official target after integer rounding.
  const short = Math.max(1, Math.floor(Math.min(w, h) * side / long + 0.5));
  const drawWidth = w >= h ? side : short;
  const drawHeight = h >= w ? side : short;
  const canvasWidth = kind === 'emoji' ? 100 : drawWidth;
  const canvasHeight = kind === 'emoji' ? 100 : drawHeight;
  const left = Math.floor((canvasWidth - drawWidth) / 2);
  const top = Math.floor((canvasHeight - drawHeight) / 2);
  return Object.freeze({
    kind,
    drawWidth,
    drawHeight,
    canvasWidth,
    canvasHeight,
    left,
    top,
    right: canvasWidth - drawWidth - left,
    bottom: canvasHeight - drawHeight - top
  });
}
