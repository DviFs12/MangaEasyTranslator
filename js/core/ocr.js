/**
 * core/ocr.js — MET10
 * Pure OCR engine. No UI dependencies.
 * Manages Tesseract worker lifecycle, region extraction, clustering.
 */

let _worker = null;
let _workerLang = null;

// ── Worker lifecycle ───────────────────────────────────────────────────────

function _waitForTesseract(ms = 20000) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const t0 = Date.now();
    const id = setInterval(() => {
      if (window.Tesseract) { clearInterval(id); resolve(window.Tesseract); }
      else if (Date.now() - t0 > ms) { clearInterval(id); reject(new Error('Tesseract timeout')); }
    }, 150);
  });
}

async function _getWorker(lang, onProgress) {
  if (_worker && _workerLang === lang) return _worker;
  if (_worker) { try { await _worker.terminate(); } catch (_) {} _worker = null; }
  const T = await _waitForTesseract();
  _worker = await T.createWorker({
    logger: m => {
      if (!onProgress) return;
      if (m.status === 'loading tesseract core') onProgress(5, 'Loading engine…');
      else if (m.status === 'loading language traineddata') onProgress(12, `Downloading ${lang}…`);
      else if (m.status === 'initializing tesseract') onProgress(18, 'Initializing…');
      else if (m.status === 'recognizing text') onProgress(20 + Math.round(m.progress * 70), 'Recognizing…');
    }
  });
  await _worker.loadLanguage(lang);
  await _worker.initialize(lang);
  _workerLang = lang;
  return _worker;
}

export async function terminateOCR() {
  if (_worker) { try { await _worker.terminate(); } catch (_) {} }
  _worker = null; _workerLang = null;
}

// ── Full page OCR ──────────────────────────────────────────────────────────

/**
 * Run OCR on an entire canvas.
 * Returns array of Block objects (id, text, bbox, confidence).
 */
export async function ocrFullPage(canvas, { lang = 'jpn', psm = '11', onProgress = () => {} } = {}) {
  const worker = await _getWorker(lang, onProgress);
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  onProgress(20, 'Analyzing…');
  const { data } = await worker.recognize(canvas.toDataURL('image/png'));
  onProgress(92, 'Clustering…');
  const blocks = _clusterWords(data, canvas.width, canvas.height);
  onProgress(100, `Done — ${blocks.length} blocks`);
  return blocks;
}

// ── Region OCR ────────────────────────────────────────────────────────────

/**
 * Run OCR on a rectangular region.
 * Returns a single Block or null.
 */
export async function ocrRegion(canvas, rect, { lang = 'jpn', psm = '6', onProgress = () => {} } = {}) {
  const crop = _cropCanvas(canvas, rect);
  return _ocrCroppedCanvas(crop, rect, { lang, psm, onProgress });
}

/**
 * Run OCR on a lasso (polygon) region — masks pixels outside polygon white.
 * Returns a single Block or null.
 */
export async function ocrLasso(canvas, points, { lang = 'jpn', psm = '6', onProgress = () => {} } = {}) {
  const bbox = _pointsBBox(points);
  const crop = _maskedCrop(canvas, points, bbox);
  return _ocrCroppedCanvas(crop, bbox, { lang, psm, onProgress });
}

/**
 * Run OCR on a rotated stroke region (line tool).
 * Returns { block, angle }.
 */
export async function ocrStroke(canvas, p1, p2, thickness = 30, { lang = 'jpn', onProgress = () => {} } = {}) {
  const { crop, angle, rect } = _strokeCrop(canvas, p1, p2, thickness);
  const block = await _ocrCroppedCanvas(crop, rect, { lang, psm: '7', onProgress });
  return block ? { block, angle } : null;
}

// ── Internal helpers ───────────────────────────────────────────────────────

async function _ocrCroppedCanvas(crop, originRect, { lang, psm, onProgress }) {
  const worker = await _getWorker(lang, onProgress);
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  onProgress(15, 'OCR region…');
  const { data } = await worker.recognize(crop.toDataURL('image/png'));
  onProgress(95, 'Processing…');
  const text = _cleanText((data.text || '').replace(/\n+/g, ' '));
  if (!text) { onProgress(100, 'No text found'); return null; }
  return {
    id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    text,
    confidence: Math.round(data.confidence || 0),
    translation: '',
    bbox: { x: originRect.x, y: originRect.y, w: originRect.w, h: originRect.h },
    visible: true,
    applied: false,
    manual: true,
  };
}

function _cropCanvas(canvas, { x, y, w, h }) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(Math.ceil(w), canvas.width - x);
  h = Math.min(Math.ceil(h), canvas.height - y);
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').drawImage(canvas, x, y, w, h, 0, 0, w, h);
  return tmp;
}

function _maskedCrop(canvas, points, bbox) {
  const { x, y, w, h } = bbox;
  const tmp = document.createElement('canvas');
  tmp.width = Math.ceil(w); tmp.height = Math.ceil(h);
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.save();
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x - x, p.y - y) : ctx.lineTo(p.x - x, p.y - y));
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
  ctx.restore();
  return tmp;
}

function _strokeCrop(canvas, p1, p2, thickness) {
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const angle = Math.atan2(dy, dx);
  const len = Math.sqrt(dx * dx + dy * dy);
  const cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
  const pad = 8;
  const cw = Math.ceil(len + pad * 2), ch = Math.ceil(thickness + pad * 2);
  const tmp = document.createElement('canvas');
  tmp.width = cw; tmp.height = ch;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(-angle);
  ctx.drawImage(canvas, -(cx), -(cy));
  ctx.restore();
  const rect = { x: p1.x - pad, y: p1.y - thickness / 2, w: cw, h: ch };
  return { crop: tmp, angle: angle * (180 / Math.PI), rect };
}

function _pointsBBox(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// ── DBSCAN Word Clustering ─────────────────────────────────────────────────

function _clusterWords(data, imgW, imgH) {
  const words = [];
  for (const tb of (data.blocks || []))
    for (const para of (tb.paragraphs || []))
      for (const line of (para.lines || []))
        for (const word of (line.words || [])) {
          const t = _cleanText(word.text);
          if (!t || word.confidence < 8) continue;
          const b = word.bbox;
          if (!b || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
          words.push({ text: t, x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, conf: word.confidence, lh: b.y1 - b.y0 });
        }
  if (!words.length) return _fallbackClusters(data);

  const HGAP = 60, VGAP = 24, SIZE_R = 1.8;
  const used = new Uint8Array(words.length);
  const clusters = [];

  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    const group = [i]; used[i] = 1;
    const queue = [i];
    while (queue.length) {
      const ci = queue.shift(), a = words[ci];
      for (let j = 0; j < words.length; j++) {
        if (used[j]) continue;
        const b = words[j];
        const yOvlp = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const hGap = Math.max(b.x0 - a.x1, a.x0 - b.x1);
        const sameLine = yOvlp > 0 && hGap >= 0 && hGap <= HGAP;
        const sizeMatch = Math.max(a.lh, b.lh) / Math.max(1, Math.min(a.lh, b.lh)) < SIZE_R;
        const xOvlp = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const vGap = Math.max(b.y0 - a.y1, a.y0 - b.y1);
        const adjLine = sizeMatch && xOvlp > -10 && vGap >= 0 && vGap <= VGAP;
        if (sameLine || adjLine) { used[j] = 1; group.push(j); queue.push(j); }
      }
    }
    const gs = group.map(i => words[i]);
    const xs = gs.flatMap(w => [w.x0, w.x1]), ys = gs.flatMap(w => [w.y0, w.y1]);
    const conf = gs.reduce((s, w) => s + w.conf, 0) / gs.length;
    gs.sort((a, b) => Math.abs(a.y0 - b.y0) > 8 ? a.y0 - b.y0 : a.x0 - b.x0);
    const lineGroups = []; let cur = [gs[0]];
    for (let k = 1; k < gs.length; k++) {
      const prev = cur[cur.length - 1];
      (Math.min(prev.y1, gs[k].y1) - Math.max(prev.y0, gs[k].y0) > 0 || Math.abs(gs[k].y0 - prev.y0) < prev.lh * 0.5)
        ? cur.push(gs[k]) : (lineGroups.push(cur), cur = [gs[k]]);
    }
    lineGroups.push(cur);
    const text = lineGroups.map(l => l.map(w => w.text).join(' ')).join('\n');
    clusters.push({
      id: `block-${clusters.length}-${Date.now()}`,
      text: _cleanText(text),
      bbox: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
      confidence: Math.round(conf),
      translation: '', visible: true, applied: false,
    });
  }
  return clusters;
}

function _fallbackClusters(data) {
  const items = []; let id = 0;
  for (const tb of (data.blocks || []))
    for (const para of (tb.paragraphs || [])) {
      const t = _cleanText(para.text); if (!t || para.confidence < 8) continue;
      const b = para.bbox; if (!b || b.x1 <= b.x0 || b.y1 <= b.y0) continue;
      items.push({ id: `block-${id++}`, text: t, confidence: Math.round(para.confidence),
        bbox: { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 }, translation: '', visible: true, applied: false });
    }
  return items;
}

function _cleanText(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
