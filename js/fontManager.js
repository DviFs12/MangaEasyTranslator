/**
 * fontManager.js — v6
 *
 * Catálogo expandido com 16 fontes gratuitas populares em scanlation.
 * Auto-seleção mais sofisticada + auto-sizing canvas-based preciso.
 */

export const FONTS = [
  // ── Ação / Impacto ───────────────────────────────────
  { name: 'Bangers',         label: 'Bangers',         style: 'action',   charW: 0.52 },
  { name: 'Luckiest Guy',    label: 'Luckiest Guy',    style: 'action',   charW: 0.58 },
  { name: 'Anton',           label: 'Anton',           style: 'impact',   charW: 0.48 },
  { name: 'Black Han Sans',  label: 'Black Han Sans',  style: 'impact',   charW: 0.56 },
  { name: 'Lilita One',      label: 'Lilita One',      style: 'impact',   charW: 0.54 },
  // ── Diálogo / Condensado ─────────────────────────────
  { name: 'Oswald',          label: 'Oswald',          style: 'dialog',   charW: 0.46 },
  { name: 'Bebas Neue',      label: 'Bebas Neue',      style: 'condensed',charW: 0.44 },
  { name: 'Righteous',       label: 'Righteous',       style: 'dialog',   charW: 0.52 },
  { name: 'Fredoka One',     label: 'Fredoka One',     style: 'dialog',   charW: 0.56 },
  // ── Comic / Legível ──────────────────────────────────
  { name: 'Comic Neue',      label: 'Comic Neue',      style: 'comic',    charW: 0.58 },
  { name: 'Nunito',          label: 'Nunito',          style: 'clean',    charW: 0.57 },
  // ── Pensamento / Manuscrito ──────────────────────────
  { name: 'Permanent Marker',label: 'Permanent Marker',style: 'thought',  charW: 0.62 },
  { name: 'Schoolbell',      label: 'Schoolbell',      style: 'thought',  charW: 0.60 },
  { name: 'Shadows Into Light',label:'Shadows Into Light',style:'whisper',charW: 0.58 },
  // ── Narração / Efeito ────────────────────────────────
  { name: 'Special Elite',   label: 'Special Elite',   style: 'narration',charW: 0.60 },
  { name: 'Press Start 2P',  label: 'Press Start 2P',  style: 'retro',    charW: 0.72 },
  // ── Fallback ─────────────────────────────────────────
  { name: 'Arial',           label: 'Arial',           style: 'system',   charW: 0.56 },
];

/**
 * Seleciona a melhor fonte para o bloco com base em heurísticas.
 * @param {{ text:string, bbox:{w,h}, balloonType?:string }} block
 * @returns {string} nome da fonte
 */
export function pickFont(block) {
  const { text, bbox, balloonType } = block;
  const area   = bbox.w * bbox.h;
  const len    = text.length;
  const upper  = len > 2 && text === text.toUpperCase() && /[A-Za-z]/.test(text);
  const shout  = /[!！]{2,}/.test(text) || upper;
  const ellip  = /\.{2,}|…/.test(text);
  const paren  = /^[\(\*「]/.test(text.trim());
  const sfx    = text.length < 6 && /[A-Z0-9!]/.test(text);
  const long   = len > 60;
  const large  = area > 20000;
  const small  = area < 3000;

  // Balloon-type hints
  if (balloonType === 'thought') return 'Shadows Into Light';
  if (balloonType === 'narration') return 'Special Elite';

  // Content-based
  if (sfx)              return 'Luckiest Guy';
  if (shout && !long)   return 'Bangers';
  if (large && !long)   return 'Anton';
  if (ellip || paren)   return 'Permanent Marker';
  if (small)            return 'Comic Neue';
  if (long)             return 'Nunito';
  return 'Oswald'; // default dialog
}

/**
 * Calcula o tamanho de fonte ideal para caber em bbox com wrap automático.
 * Usa medição real via OffscreenCanvas quando disponível.
 *
 * @param {string}  text
 * @param {{w,h}}   bbox
 * @param {string}  fontName
 * @param {number}  minSize
 * @param {number}  maxSize
 * @returns {number}
 */
export function pickFontSize(text, bbox, fontName = 'Oswald', minSize = 9, maxSize = 72) {
  const entry   = FONTS.find(f => f.name === fontName) || FONTS[0];
  const charW   = entry.charW;
  const lineH   = 1.35;
  const PAD     = 0.88; // use 88% of bbox

  const lines   = text.split('\n');
  const longest = lines.reduce((a, b) => a.length > b.length ? a : b, '');
  const nLines  = Math.max(lines.length, 1);

  // Estimate: fit longest line horizontally
  const byWidth  = (bbox.w * PAD) / Math.max(longest.length * charW, 1);
  // Estimate: fit all lines vertically
  const byHeight = (bbox.h * PAD) / (nLines * lineH);

  const raw = Math.floor(Math.min(byWidth, byHeight));

  // If OffscreenCanvas available, verify with canvas measurement (more accurate)
  if (typeof OffscreenCanvas !== 'undefined') {
    return _binaryFitSize(text, bbox, fontName, minSize, maxSize, raw);
  }

  return Math.max(minSize, Math.min(maxSize, raw));
}

/**
 * Binary search for the largest font size where wrapped text fits in bbox.
 * Only runs if OffscreenCanvas is available (no DOM needed).
 */
function _binaryFitSize(text, bbox, fontName, minSize, maxSize, hint) {
  const oc  = new OffscreenCanvas(bbox.w + 40, bbox.h + 40);
  const ctx = oc.getContext('2d');
  const PAD_W = bbox.w * 0.9;
  const PAD_H = bbox.h * 0.9;

  // Start from hint ± 10 for speed
  let lo = Math.max(minSize, hint - 12);
  let hi = Math.min(maxSize, hint + 12);
  let best = lo;

  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    ctx.font = `bold ${mid}px '${fontName}',sans-serif`;
    const totalH = _wrappedHeight(ctx, text, PAD_W, mid * 1.35);
    const maxLineW = _maxLineWidth(ctx, text, PAD_W);

    if (maxLineW <= PAD_W && totalH <= PAD_H) {
      best = mid; lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return Math.max(minSize, best);
}

function _wrappedHeight(ctx, text, maxW, lineH) {
  let lines = 0;
  for (const para of text.split('\n')) {
    if (!para) { lines++; continue; }
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxW && cur) { lines++; cur = w; }
      else cur = t;
    }
    lines++;
  }
  return lines * lineH;
}

function _maxLineWidth(ctx, text, maxW) {
  let max = 0;
  for (const para of text.split('\n')) {
    let cur = '';
    for (const w of para.split(' ')) {
      const t = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(t).width > maxW && cur) {
        max = Math.max(max, ctx.measureText(cur).width); cur = w;
      } else cur = t;
    }
    max = Math.max(max, ctx.measureText(cur).width);
  }
  return max;
}
