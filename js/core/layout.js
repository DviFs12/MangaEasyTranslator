/**
 * core/layout.js — MET10
 * Pure text layout engine. No canvas rendering, no DOM.
 * Computes font sizes, line breaks, and bounding boxes.
 */

/**
 * Compute the best font size so text fits within (w × h).
 * Returns { fontSize, lines }
 */
export function fitTextInBox(text, w, h, opts = {}) {
  const {
    fontFamily = 'Bangers',
    minSize = 8,
    maxSize = 72,
    lineHeightRatio = 1.25,
    padding = 6,
  } = opts;

  const inner_w = w - padding * 2;
  const inner_h = h - padding * 2;
  if (inner_w <= 0 || inner_h <= 0) return { fontSize: minSize, lines: [text] };

  const measure = _makeMeasure(fontFamily);

  let lo = minSize, hi = maxSize, best = minSize;
  let bestLines = [text];

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const { lines, totalH } = _wrap(text, inner_w, mid, lineHeightRatio, measure);
    if (totalH <= inner_h) {
      best = mid; bestLines = lines; lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return { fontSize: best, lines: bestLines };
}

/**
 * Wrap text to lines that fit within maxW at fontSize.
 */
export function wrapText(text, maxW, fontSize, fontFamily = 'Bangers', lineHeightRatio = 1.25) {
  const measure = _makeMeasure(fontFamily);
  const { lines, totalH } = _wrap(text, maxW, fontSize, lineHeightRatio, measure);
  return { lines, totalH };
}

/**
 * Measure text width at a given font size.
 */
export function measureText(text, fontSize, fontFamily = 'Bangers') {
  const measure = _makeMeasure(fontFamily);
  return measure(text, fontSize);
}

// ── Internal ───────────────────────────────────────────────────────────────

let _measureCanvas = null;
let _measureCtx = null;
const _measureCache = new Map();

function _makeMeasure(fontFamily) {
  if (!_measureCanvas) {
    _measureCanvas = document.createElement('canvas');
    _measureCtx = _measureCanvas.getContext('2d');
  }
  return (text, size) => {
    const key = `${fontFamily}|${size}|${text}`;
    if (_measureCache.has(key)) return _measureCache.get(key);
    _measureCtx.font = `${size}px "${fontFamily}"`;
    const w = _measureCtx.measureText(text).width;
    if (_measureCache.size > 2000) _measureCache.clear();
    _measureCache.set(key, w);
    return w;
  };
}

function _wrap(text, maxW, fontSize, lhRatio, measure) {
  const lineH = fontSize * lhRatio;
  const rawLines = text.split('\n');
  const lines = [];

  for (const rawLine of rawLines) {
    const words = rawLine.split(' ');
    let current = '';
    for (const word of words) {
      const test = current ? current + ' ' + word : word;
      if (measure(test, fontSize) <= maxW) {
        current = test;
      } else {
        if (current) lines.push(current);
        // If single word is too wide, force it
        current = word;
      }
    }
    if (current) lines.push(current);
    if (!rawLine.trim()) lines.push('');
  }

  return { lines, totalH: lines.length * lineH };
}

/**
 * Render text into a canvas context at given position.
 * Used by renderer — not by UI.
 */
export function renderTextBlock(ctx, block, opts = {}) {
  const {
    fontSize,
    fontFamily = 'Bangers',
    color = '#000000',
    bgColor = '#ffffff',
    bgOpacity = 0.9,
    align = 'center',
    lineHeightRatio = 1.25,
    padding = 6,
    rotation = 0,
  } = block;

  const { x, y, w, h, text } = block;
  if (!text || !w || !h) return;

  const { lines } = fitTextInBox(text, w, h, { fontFamily, minSize: 8, maxSize: 72, lineHeightRatio, padding });
  const lineH = fontSize * lineHeightRatio;

  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (rotation) ctx.rotate(rotation * Math.PI / 180);
  ctx.translate(-(w / 2), -(h / 2));

  // Background
  if (bgOpacity > 0) {
    ctx.globalAlpha = bgOpacity;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // Text
  ctx.font = `${fontSize}px "${fontFamily}"`;
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  ctx.textAlign = align;
  const textX = align === 'center' ? w / 2 : align === 'right' ? w - padding : padding;
  const totalH = lines.length * lineH;
  const startY = (h - totalH) / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, textX, startY + i * lineH);
  });

  ctx.restore();
}
