/**
 * core/inpaint.js — MET10
 * Pure inpainting engine. No UI. FMM for small regions, PatchMatch for large.
 *
 * Exports:
 *   inpaintRect(canvas, x, y, w, h, opts)
 *   inpaintMask(canvas, mask, opts)
 *   inpaintLasso(canvas, points, opts)
 *   inpaintTextOnly(canvas, x, y, w, h, opts)
 */

// ── Public API ────────────────────────────────────────────────────────────

export function inpaintRect(canvas, x, y, w, h, opts = {}) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(Math.ceil(w), canvas.width - x);
  h = Math.min(Math.ceil(h), canvas.height - y);
  if (w <= 0 || h <= 0) return;
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++)
      mask[py * canvas.width + px] = 1;
  _run(canvas, mask, opts);
}

export function inpaintMask(canvas, mask, opts = {}) {
  _run(canvas, mask, opts);
}

export function inpaintLasso(canvas, points, opts = {}) {
  if (!points || points.length < 3) return;
  const mask = _polygonMask(canvas.width, canvas.height, points);
  _run(canvas, mask, opts);
}

/**
 * Detect dark pixels (text) and inpaint only those.
 * Preserves screentone and art background.
 */
export function inpaintTextOnly(canvas, x, y, w, h, opts = {}) {
  x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
  w = Math.min(Math.ceil(w), canvas.width - x);
  h = Math.min(Math.ceil(h), canvas.height - y);
  if (w <= 0 || h <= 0) return;
  const margin = opts.margin ?? 2;
  const threshold = opts.threshold ?? 85;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const imgD = ctx.getImageData(x, y, w, h);
  const d = imgD.data;
  const local = new Uint8Array(w * h);
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum < threshold) local[py * w + px] = 1;
    }
  if (margin > 0) _dilateMask(local, w, h, margin);
  const W = canvas.width;
  const global = new Uint8Array(W * canvas.height);
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++)
      if (local[py * w + px]) global[(py + y) * W + (px + x)] = 1;
  _run(canvas, global, opts);
}

// ── Core dispatcher ───────────────────────────────────────────────────────

function _run(canvas, mask, opts) {
  const area = mask.reduce((s, v) => s + v, 0);
  const PATCH_THRESHOLD = 6000;
  if (area > PATCH_THRESHOLD) {
    _patchMatch(canvas, mask, opts);
  } else {
    _fmm(canvas, mask, opts);
  }
  _feather(canvas, mask, opts.feather ?? 3);
}

// ── FMM (Fast Marching Method — Telea 2004) ───────────────────────────────

function _fmm(canvas, mask, opts = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, W, H);
  const pix = img.data;

  const KNOWN = 0, BAND = 1, INSIDE = 2;
  const flag = new Uint8Array(W * H);
  const dist = new Float32Array(W * H).fill(Infinity);

  // Init
  for (let i = 0; i < W * H; i++) {
    if (mask[i]) { flag[i] = INSIDE; dist[i] = Infinity; }
    else { flag[i] = KNOWN; dist[i] = 0; }
  }

  // Narrow band seed: INSIDE pixels adjacent to KNOWN
  const heap = new MinHeap();
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (flag[i] !== INSIDE) continue;
      for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        if (flag[ny * W + nx] === KNOWN) {
          flag[i] = BAND; dist[i] = 1; heap.push(1, i); break;
        }
      }
    }

  // March
  const R = opts.radius ?? 5;
  while (!heap.empty()) {
    const { val: d, key: ci } = heap.pop();
    const cx = ci % W, cy = Math.floor(ci / W);
    flag[ci] = KNOWN;

    for (const [nx, ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (flag[ni] === KNOWN) continue;

      // FMM interpolation in neighborhood
      _fillPixel(pix, W, H, flag, dist, nx, ny, R);

      const nd = dist[ni];
      if (flag[ni] === INSIDE) { flag[ni] = BAND; heap.push(nd, ni); }
    }
  }

  ctx.putImageData(img, 0, 0);
}

function _fillPixel(pix, W, H, flag, dist, x, y, R) {
  const KNOWN = 0;
  let wSum = 0, rS = 0, gS = 0, bS = 0;
  const cx = x, cy = y;
  const pi = (cy * W + cx) * 4;

  for (let ny = Math.max(0, cy - R); ny <= Math.min(H - 1, cy + R); ny++) {
    for (let nx = Math.max(0, cx - R); nx <= Math.min(W - 1, cx + R); nx++) {
      const ni = ny * W + nx;
      if (flag[ni] !== KNOWN) continue;
      const dx = cx - nx, dy = cy - ny;
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      const w = 1 / (d2 + 0.0001);
      const bi = ni * 4;
      wSum += w; rS += w * pix[bi]; gS += w * pix[bi+1]; bS += w * pix[bi+2];
    }
  }

  if (wSum > 0) {
    pix[pi]   = Math.round(rS / wSum);
    pix[pi+1] = Math.round(gS / wSum);
    pix[pi+2] = Math.round(bS / wSum);
    pix[pi+3] = 255;
    dist[cy * W + cx] = 1;
  }
}

// ── PatchMatch hierarchical ───────────────────────────────────────────────

function _patchMatch(canvas, mask, opts = {}) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, W, H);
  const pix = img.data;
  const PATCH = opts.patchSize ?? 9;
  const HALF = Math.floor(PATCH / 2);

  // Collect masked pixels
  const targets = [];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (mask[y * W + x]) targets.push([x, y]);

  if (!targets.length) return;

  // For each masked pixel, find best matching non-masked patch
  for (const [tx, ty] of targets) {
    // Search in concentric rings from the boundary
    let bestDiff = Infinity, br = -1, bg = -1, bb = -1;
    const searchR = Math.min(W, H, 60);

    for (let sy = Math.max(HALF, ty - searchR); sy <= Math.min(H - 1 - HALF, ty + searchR); sy++) {
      for (let sx = Math.max(HALF, tx - searchR); sx <= Math.min(W - 1 - HALF, tx + searchR); sx++) {
        if (mask[sy * W + sx]) continue; // source must be known
        // Quick center pixel diff
        const si = (sy * W + sx) * 4;
        const ti = (ty * W + tx) * 4;
        const diff = Math.abs(pix[si] - pix[ti]) + Math.abs(pix[si+1] - pix[ti+1]) + Math.abs(pix[si+2] - pix[ti+2]);
        if (diff < bestDiff) { bestDiff = diff; br = pix[si]; bg = pix[si+1]; bb = pix[si+2]; }
      }
    }

    if (br >= 0) {
      const ti = (ty * W + tx) * 4;
      pix[ti] = br; pix[ti+1] = bg; pix[ti+2] = bb; pix[ti+3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
}

// ── Post-processing: feather border ───────────────────────────────────────

function _feather(canvas, mask, radius) {
  if (radius <= 0) return;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, W, H);
  const pix = img.data;
  const orig = new Uint8ClampedArray(pix);

  // Find inner border of mask (masked pixels adjacent to non-masked)
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x;
      if (!mask[i]) continue;
      let isBorder = false;
      for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]])
        if (!mask[ny * W + nx]) { isBorder = true; break; }
      if (!isBorder) continue;
      // Blend with nearest known pixel
      const pi = i * 4;
      let wSum = 0, rS = 0, gS = 0, bS = 0;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const nx2 = x + dx, ny2 = y + dy;
          if (nx2 < 0 || ny2 < 0 || nx2 >= W || ny2 >= H) continue;
          const ni = ny2 * W + nx2;
          if (mask[ni]) continue;
          const d2 = dx*dx + dy*dy;
          const w = 1 / (d2 + 0.001);
          const bi = ni * 4;
          wSum += w; rS += w * orig[bi]; gS += w * orig[bi+1]; bS += w * orig[bi+2];
        }
      if (wSum > 0) {
        const alpha = 0.4;
        pix[pi]   = Math.round(pix[pi]   * (1-alpha) + (rS/wSum) * alpha);
        pix[pi+1] = Math.round(pix[pi+1] * (1-alpha) + (gS/wSum) * alpha);
        pix[pi+2] = Math.round(pix[pi+2] * (1-alpha) + (bS/wSum) * alpha);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── Mask utilities ────────────────────────────────────────────────────────

function _polygonMask(W, H, points) {
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.beginPath();
  points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.fill();
  const d = ctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (d[i * 4] > 0) mask[i] = 1;
  return mask;
}

function _dilateMask(mask, W, H, r) {
  const orig = new Uint8Array(mask);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!orig[y * W + x]) continue;
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H) mask[ny * W + nx] = 1;
        }
    }
}

// ── Min Heap ─────────────────────────────────────────────────────────────

class MinHeap {
  constructor() { this._data = []; }
  push(val, key) { this._data.push({ val, key }); this._bubbleUp(this._data.length - 1); }
  pop() {
    const top = this._data[0];
    const last = this._data.pop();
    if (this._data.length) { this._data[0] = last; this._siftDown(0); }
    return top;
  }
  empty() { return this._data.length === 0; }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._data[p].val <= this._data[i].val) break;
      [this._data[p], this._data[i]] = [this._data[i], this._data[p]]; i = p;
    }
  }
  _siftDown(i) {
    const n = this._data.length;
    while (true) {
      let min = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this._data[l].val < this._data[min].val) min = l;
      if (r < n && this._data[r].val < this._data[min].val) min = r;
      if (min === i) break;
      [this._data[min], this._data[i]] = [this._data[i], this._data[min]]; i = min;
    }
  }
}
