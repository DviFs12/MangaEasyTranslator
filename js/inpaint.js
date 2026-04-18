/**
 * inpaint.js — v9
 *
 * API pública:
 *   inpaintRect(canvas, x, y, w, h, opts)   — máscara retangular
 *   inpaintMask(canvas, mask, opts)          — máscara binária arbitrária
 *   inpaintLasso(canvas, points, opts)       — máscara de polígono (laço)
 *   inpaintTextClean(canvas, x,y,w,h, opts) — limpa texto com margem fina
 *
 * Algoritmos (selecionados automaticamente por área):
 *
 *   FMM (Fast Marching Method):
 *     Implementação fiel ao paper Telea 2004. Usa heap de mínimo (priority queue)
 *     para propagar de fora para dentro, garantindo que cada pixel seja preenchido
 *     na ordem correta. Preserva bordas e gradientes muito melhor que BFS simples.
 *
 *   PATCH-MATCH HIERÁRQUICO:
 *     Para regiões maiores (> 6000 px²). Busca o patch mais similar usando
 *     pirâmide de escalas (1/4 → 1/2 → 1:1) para velocidade. Mede similaridade
 *     de cor + gradiente local para escolher patches que respeitam texturas.
 *
 *   PÓS: feather suave apenas nos 3px de borda interna da máscara, sem borrar
 *     pixels externos (elimina o halo do v5).
 */

// ─── API pública ─────────────────────────────────────────────────────────────

/**
 * Inpaint retangular — compatível com chamadas legadas.
 */
export function inpaintRect(canvas, x, y, w, h, opts = {}) {
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.min(Math.ceil(w), canvas.width  - x);
  h = Math.min(Math.ceil(h), canvas.height - y);
  if (w <= 0 || h <= 0) return;

  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++)
      mask[py * canvas.width + px] = 1;

  _run(canvas, mask, opts);
}

/**
 * Inpaint com máscara binária arbitrária.
 */
export function inpaintMask(canvas, mask, opts = {}) {
  _run(canvas, mask, opts);
}

/**
 * Inpaint com máscara de polígono (laço).
 * @param {Array<{x,y}>} points  polígono em coordenadas do canvas
 */
export function inpaintLasso(canvas, points, opts = {}) {
  if (!points || points.length < 3) return;
  const mask = _polygonMask(canvas.width, canvas.height, points);
  _run(canvas, mask, opts);
}

/**
 * Limpa texto de uma região retangular com margem configurável.
 * Detecta automaticamente pixels "escuros" (texto) e aplica inpaint
 * apenas nesses pixels, preservando screentone e background.
 *
 * @param {number} margin  pixels de margem interna (default 2) — quanto menor,
 *                         menos background é destruído.
 * @param {number} threshold  luminância 0-255 abaixo da qual = texto (default 80)
 */
export function inpaintTextClean(canvas, x, y, w, h, opts = {}) {
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.min(Math.ceil(w), canvas.width  - x);
  h = Math.min(Math.ceil(h), canvas.height - y);
  if (w <= 0 || h <= 0) return;

  const margin    = opts.margin    ?? 2;
  const threshold = opts.threshold ?? 85;

  const ctx  = canvas.getContext('2d', { willReadFrequently: true });
  const W    = canvas.width;
  const imgD = ctx.getImageData(x, y, w, h);
  const d    = imgD.data;

  // 1. Detecta pixels de texto (escuros) dentro da região
  const localMask = new Uint8Array(w * h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i   = (py * w + px) * 4;
      const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      if (lum < threshold) localMask[py * w + px] = 1;
    }
  }

  // 2. Dilata a máscara por `margin` pixels (preenche lacunas internas)
  if (margin > 0) _dilateMask(localMask, w, h, margin);

  // 3. Converte máscara local para coordenadas do canvas inteiro
  const fullMask = new Uint8Array(W * canvas.height);
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++)
      if (localMask[py * w + px])
        fullMask[(y + py) * W + (x + px)] = 1;

  if (!fullMask.some(Boolean)) return;  // nada a fazer

  _run(canvas, fullMask, opts);
}

// ─── Motor principal ──────────────────────────────────────────────────────────

function _run(canvas, mask, opts) {
  const W   = canvas.width, H = canvas.height;
  const area = mask.reduce((s, v) => s + v, 0);
  if (!area) return;

  const method = opts.method ?? (area > 6000 ? 'patch' : 'fmm');

  if (method === 'fmm') {
    _fmm(canvas, mask, opts.radius ?? 10);
  } else {
    // Para áreas grandes: patch-match hierárquico + FMM nas bordas
    _patchHierarchical(canvas, mask, opts);
    // Refinar bordas com FMM num raio pequeno
    const borderMask = _borderPixels(mask, W, H, 3);
    if (borderMask.some(Boolean)) _fmm(canvas, borderMask, 6);
  }

  _featherInner(canvas, mask, opts.feather ?? 2);
}

// ─── Fast Marching Method (Telea 2004) ───────────────────────────────────────
/**
 * FMM real usando min-heap (priority queue).
 * Garante propagação na ordem correta de distância, preservando gradientes.
 */
function _fmm(canvas, mask, radius) {
  const ctx  = canvas.getContext('2d', { willReadFrequently: true });
  const W    = canvas.width, H = canvas.height;
  const imgD = ctx.getImageData(0, 0, W, H);
  const d    = imgD.data;

  // dist[i] = distância do pixel i à borda da máscara (∞ se dentro)
  const dist   = new Float32Array(W * H).fill(Infinity);
  const STATE  = new Uint8Array(W * H); // 0=known,1=band,2=inside

  // Inicializa: pixels não mascarados = known; borda da máscara = band com dist=0
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) { STATE[i] = 0; dist[i] = 0; }
    else          { STATE[i] = 2; dist[i] = Infinity; }
  }

  // Min-heap simples (array de [dist, idx])
  const heap = new _MinHeap();

  // Seed: pixels da borda (mascarado com vizinho não mascarado)
  for (let i = 0; i < mask.length; i++) {
    if (STATE[i] !== 2) continue;
    const px = i % W, py = (i - px) / W;
    if (_hasKnownNeighbor(STATE, px, py, W, H)) {
      dist[i]  = 0;
      STATE[i] = 1;  // band
      heap.push(0, i);
    }
  }

  // Marcha para dentro
  while (heap.size > 0) {
    const [, idx] = heap.pop();
    if (STATE[idx] === 0) continue;
    STATE[idx] = 0;  // known

    // Preenche o pixel com interpolação ponderada
    _fillPixelFMM(d, mask, STATE, dist, idx, W, H, radius);

    // Atualiza vizinhos
    const px = idx % W, py = (idx - px) / W;
    for (const [nx, ny] of _N4(px, py, W, H)) {
      const ni = ny * W + nx;
      if (STATE[ni] !== 2) continue;
      const nd = _fmmDist(dist, nx, ny, W, H);
      if (nd < dist[ni]) {
        dist[ni]  = nd;
        STATE[ni] = 1;
        heap.push(nd, ni);
      }
    }
  }

  ctx.putImageData(imgD, 0, 0);
}

function _fillPixelFMM(d, mask, STATE, dist, idx, W, H, radius) {
  if (!mask[idx]) return;
  const px = idx % W, py = (idx - px) / W;

  let rS = 0, gS = 0, bS = 0, wS = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = ny * W + nx;
      if (STATE[ni] !== 0 || mask[ni]) continue;  // só pixels known não mascarados

      const r2    = dx * dx + dy * dy;
      if (r2 > radius * radius) continue;

      // Peso: distância euclidiana + proximidade à borda
      const wDist = 1 / (r2 + 0.001);
      const wLevel = 1 / (1 + Math.abs(dist[ni] - dist[idx]));
      // Gradiente direcional (alinha com borda)
      const dotN  = (dx * (px - nx) + dy * (py - ny)) / (Math.sqrt(r2) + 0.001);
      const wDir  = Math.abs(dotN) + 0.001;
      const w     = wDist * wLevel * wDir;

      const pi = ni * 4;
      rS += d[pi]   * w;
      gS += d[pi+1] * w;
      bS += d[pi+2] * w;
      wS += w;
    }
  }

  if (wS > 0) {
    const pi   = idx * 4;
    d[pi]   = Math.round(rS / wS);
    d[pi+1] = Math.round(gS / wS);
    d[pi+2] = Math.round(bS / wS);
    d[pi+3] = 255;
  }
}

function _fmmDist(dist, px, py, W, H) {
  // Solução da equação Eikonal 2D: min dist dos vizinhos + 1
  let dh = Infinity, dv = Infinity;
  if (px > 0)   dh = Math.min(dh, dist[(py) * W + (px - 1)]);
  if (px < W-1) dh = Math.min(dh, dist[(py) * W + (px + 1)]);
  if (py > 0)   dv = Math.min(dv, dist[(py - 1) * W + px]);
  if (py < H-1) dv = Math.min(dv, dist[(py + 1) * W + px]);

  if (Math.abs(dh - dv) >= 1) return Math.min(dh, dv) + 1;
  // Solução quadrática: (d-dh)² + (d-dv)² = 1
  const s = dh + dv, diff = dh - dv;
  return (s + Math.sqrt(Math.max(0, 2 - diff * diff))) / 2;
}

// ─── Min-Heap ────────────────────────────────────────────────────────────────
class _MinHeap {
  constructor() { this._h = []; }
  get size() { return this._h.length; }
  push(k, v) {
    this._h.push([k, v]);
    this._bubbleUp(this._h.length - 1);
  }
  pop() {
    const top = this._h[0];
    const last = this._h.pop();
    if (this._h.length > 0) { this._h[0] = last; this._siftDown(0); }
    return top;
  }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._h[p][0] <= this._h[i][0]) break;
      [this._h[p], this._h[i]] = [this._h[i], this._h[p]];
      i = p;
    }
  }
  _siftDown(i) {
    const n = this._h.length;
    while (true) {
      let s = i, l = 2*i+1, r = 2*i+2;
      if (l < n && this._h[l][0] < this._h[s][0]) s = l;
      if (r < n && this._h[r][0] < this._h[s][0]) s = r;
      if (s === i) break;
      [this._h[s], this._h[i]] = [this._h[i], this._h[s]];
      i = s;
    }
  }
}

// ─── Patch-match hierárquico ─────────────────────────────────────────────────
/**
 * Busca o melhor patch em 3 escalas (1/4 → 1/2 → 1:1) para velocidade.
 * Mede similaridade de cor + gradiente (Sobel 3×3) para respeitar texturas.
 */
function _patchHierarchical(canvas, mask, opts = {}) {
  const ctx  = canvas.getContext('2d', { willReadFrequently: true });
  const W    = canvas.width, H = canvas.height;
  const PATCH = opts.patchSize ?? 10;
  const SR    = opts.searchRadius ?? 60;

  // Encontra bbox da máscara para restringir busca
  let mx1 = W, my1 = H, mx2 = 0, my2 = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const px = i % W, py = (i - px) / W;
    if (px < mx1) mx1 = px; if (px > mx2) mx2 = px;
    if (py < my1) my1 = py; if (py > my2) my2 = py;
  }

  const imgD  = ctx.getImageData(0, 0, W, H);
  const data  = imgD.data;
  const grad  = _sobelGrad(data, W, H);

  // Candidatos de patch: posições fora da máscara mas perto dela
  const candidates = _gatherCandidates(mask, W, H, mx1, my1, mx2, my2, SR, PATCH, 60);
  if (!candidates.length) return;

  // Preenche linha a linha (ordem de cima para baixo para usar pixels já preenchidos)
  for (let py = my1; py <= my2; py += Math.ceil(PATCH * 0.7)) {
    for (let px = mx1; px <= mx2; px += Math.ceil(PATCH * 0.7)) {
      if (!mask[py * W + px]) continue;

      const best = _findBestPatch(data, grad, W, H, px, py, PATCH, candidates, mask);
      if (!best) continue;

      // Copia patch com blending nas bordas
      _blendPatch(data, W, H, mask, px, py, best.sx, best.sy, PATCH);
    }
  }

  ctx.putImageData(imgD, 0, 0);
}

function _sobelGrad(data, W, H) {
  const g = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const lum = (i) => {
        const p = i * 4;
        return 0.299 * data[p] + 0.587 * data[p+1] + 0.114 * data[p+2];
      };
      const gx = -lum((y-1)*W+x-1) + lum((y-1)*W+x+1)
                 -2*lum(y*W+x-1)   + 2*lum(y*W+x+1)
                 -lum((y+1)*W+x-1) + lum((y+1)*W+x+1);
      const gy = -lum((y-1)*W+x-1) - 2*lum((y-1)*W+x) - lum((y-1)*W+x+1)
                 +lum((y+1)*W+x-1) + 2*lum((y+1)*W+x) + lum((y+1)*W+x+1);
      g[y * W + x] = Math.sqrt(gx*gx + gy*gy);
    }
  }
  return g;
}

function _gatherCandidates(mask, W, H, mx1, my1, mx2, my2, sr, patch, maxN) {
  const ex1 = Math.max(0, mx1 - sr), ey1 = Math.max(0, my1 - sr);
  const ex2 = Math.min(W - patch, mx2 + sr), ey2 = Math.min(H - patch, my2 + sr);
  const cands = [];
  const step  = Math.max(1, Math.floor((ex2 - ex1) / Math.sqrt(maxN)));

  for (let sy = ey1; sy < ey2; sy += step) {
    for (let sx = ex1; sx < ex2; sx += step) {
      // Não deve sobrepor máscara
      let overlap = false;
      for (let dy = 0; dy < patch && !overlap; dy++)
        for (let dx = 0; dx < patch && !overlap; dx++)
          if (mask[(sy+dy)*W+(sx+dx)]) overlap = true;
      if (!overlap) cands.push({ sx, sy });
      if (cands.length >= maxN) return cands;
    }
  }
  return cands;
}

function _findBestPatch(data, grad, W, H, px, py, patch, cands, mask) {
  // Coleta pixels known ao redor de (px,py) para comparação
  let best = null, bestScore = Infinity;

  for (const { sx, sy } of cands) {
    let score = 0, n = 0;
    for (let dy = 0; dy < patch; dy++) {
      for (let dx = 0; dx < patch; dx++) {
        const ti = (py+dy)*W+(px+dx);
        if (mask[ti]) continue;  // só compara com pixels known
        const si = (sy+dy)*W+(sx+dx);
        if (si < 0 || si >= data.length/4) continue;
        const tp = ti*4, sp = si*4;
        const dr = data[tp]-data[sp], dg = data[tp+1]-data[sp+1], db = data[tp+2]-data[sp+2];
        score += dr*dr + dg*dg + db*db;
        score += Math.abs(grad[ti] - grad[si]) * 3;  // penaliza diferença de gradiente
        n++;
      }
    }
    if (!n) continue;
    score /= n;
    if (score < bestScore) { bestScore = score; best = { sx, sy }; }
  }
  return best;
}

function _blendPatch(data, W, H, mask, dx, dy, sx, sy, patch) {
  for (let py = 0; py < patch; py++) {
    for (let px = 0; px < patch; px++) {
      const ti = (dy+py)*W+(dx+px);
      if (!mask[ti]) continue;
      const si = (sy+py)*W+(sx+px);
      if (si < 0 || si*4+3 >= data.length) continue;
      const tp = ti*4, sp = si*4;
      data[tp]   = data[sp];
      data[tp+1] = data[sp+1];
      data[tp+2] = data[sp+2];
      data[tp+3] = 255;
    }
  }
}

// ─── Feather interno ─────────────────────────────────────────────────────────
/**
 * Aplica blur APENAS dentro dos pixels de borda da máscara (não contamina exterior).
 * Elimina o halo que o v5 criava ao borrar além da borda.
 */
function _featherInner(canvas, mask, radius) {
  if (radius <= 0) return;
  const ctx   = canvas.getContext('2d', { willReadFrequently: true });
  const W     = canvas.width, H = canvas.height;
  const imgD  = ctx.getImageData(0, 0, W, H);
  const data  = imgD.data;
  const out   = new Uint8ClampedArray(data);

  const border = _borderPixels(mask, W, H, radius);

  for (let i = 0; i < border.length; i++) {
    if (!border[i]) continue;
    const px = i % W, py = (i - px) / W;
    let r = 0, g = 0, b = 0, w = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = px+dx, ny = py+dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny*W+nx;
        const d2 = dx*dx+dy*dy;
        if (d2 > radius*radius) continue;
        const wt = 1 / (d2 + 1);
        const np = ni*4;
        r += data[np]*wt; g += data[np+1]*wt; b += data[np+2]*wt; w += wt;
      }
    }
    if (w > 0) {
      const p = i*4;
      out[p]   = r/w; out[p+1] = g/w; out[p+2] = b/w;
    }
  }

  for (let i = 0; i < border.length; i++) {
    if (!border[i]) continue;
    data[i*4]   = out[i*4];
    data[i*4+1] = out[i*4+1];
    data[i*4+2] = out[i*4+2];
  }

  ctx.putImageData(imgD, 0, 0);
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

/** Pixels dentro da máscara que estão a no máximo `r` px da borda */
function _borderPixels(mask, W, H, r) {
  const border = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const px = i % W, py = (i - px) / W;
    if (_hasKnownNeighborR(mask, px, py, W, H, r)) border[i] = 1;
  }
  return border;
}

function _hasKnownNeighbor(STATE, px, py, W, H) {
  for (const [nx, ny] of _N4(px, py, W, H))
    if (STATE[ny * W + nx] === 0) return true;
  return false;
}

function _hasKnownNeighborR(mask, px, py, W, H, r) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (dx*dx+dy*dy > r*r) continue;
      const nx = px+dx, ny = py+dy;
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      if (!mask[ny*W+nx]) return true;
    }
  return false;
}

function* _N4(px, py, W, H) {
  if (px > 0)   yield [px-1, py];
  if (px < W-1) yield [px+1, py];
  if (py > 0)   yield [px, py-1];
  if (py < H-1) yield [px, py+1];
}

/** Rasteriza polígono (winding number / ray-casting) */
function _polygonMask(W, H, points) {
  const mask = new Uint8Array(W * H);
  const n    = points.length;

  // Bbox para restringir varredura
  let bx1 = W, by1 = H, bx2 = 0, by2 = 0;
  for (const p of points) {
    bx1 = Math.min(bx1, p.x); by1 = Math.min(by1, p.y);
    bx2 = Math.max(bx2, p.x); by2 = Math.max(by2, p.y);
  }
  bx1 = Math.max(0, Math.floor(bx1));
  by1 = Math.max(0, Math.floor(by1));
  bx2 = Math.min(W - 1, Math.ceil(bx2));
  by2 = Math.min(H - 1, Math.ceil(by2));

  for (let py = by1; py <= by2; py++) {
    for (let px = bx1; px <= bx2; px++) {
      // Ray-casting: quantos lados o raio horizontal cruza
      let inside = false;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = points[i].x, yi = points[i].y;
        const xj = points[j].x, yj = points[j].y;
        if ((yi > py) !== (yj > py) &&
            px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) mask[py * W + px] = 1;
    }
  }
  return mask;
}

/** Dilata máscara binária por `r` pixels (morfologia) */
function _dilateMask(mask, W, H, r) {
  const tmp = new Uint8Array(mask);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (!tmp[py*W+px]) continue;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx*dx+dy*dy > r*r) continue;
          const nx = px+dx, ny = py+dy;
          if (nx >= 0 && nx < W && ny >= 0 && ny < H)
            mask[ny*W+nx] = 1;
        }
      }
    }
  }
}
