/**
 * inpaint.js — v5
 *
 * Inpainting automático 100% frontend — remove texto de forma visual limpa.
 *
 * Estratégia em 3 camadas (aplicadas na ordem):
 *
 *  1. TELEA-LITE: algoritmo simplificado inspirado no paper Telea 2004.
 *     Preenche pixels na máscara usando média ponderada dos pixels vizinhos
 *     fora da máscara, ponderados por distância e gradiente de borda.
 *     Resultado: suave, sem halos.
 *
 *  2. PATCH-MATCH SIMPLIFICADO: para regiões maiores, encontra o patch
 *     mais similar na vizinhança e copia. Iteração única (não convergido)
 *     mas rápida e suficiente para backgrounds de screentone.
 *
 *  3. PÓS-PROCESSAMENTO: blur suave nas bordas da região para eliminar
 *     artefatos de junção.
 *
 * API:
 *   inpaintRegion(canvas, mask, options) → modifica canvas in-place
 *   inpaintRect(canvas, x, y, w, h, options) → conveniência
 */

/**
 * Inpaints uma região retangular no canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {number} x, y, w, h — região da máscara em coordenadas do canvas
 * @param {object} opts
 *   opts.method: 'telea' | 'patch' | 'auto' (default)
 *   opts.radius: raio de busca em pixels (default: 8)
 *   opts.feather: pixels de feather nas bordas (default: 3)
 */
export function inpaintRect(canvas, x, y, w, h, opts = {}) {
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.min(Math.ceil(w), canvas.width  - x);
  h = Math.min(Math.ceil(h), canvas.height - y);
  if (w <= 0 || h <= 0) return;

  const area   = w * h;
  const method = opts.method ?? (area > 4000 ? 'patch' : 'telea');

  // Create binary mask (1 = needs inpainting)
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++)
      mask[py * canvas.width + px] = 1;

  if (method === 'telea' || method === 'auto') {
    _telea(canvas, mask, opts.radius ?? 8);
  } else {
    _patchFill(canvas, x, y, w, h, opts.radius ?? 16);
  }

  if (opts.feather !== 0) _featherBorder(canvas, x, y, w, h, opts.feather ?? 3);
}

/**
 * Inpaint using a custom binary mask (Uint8Array, same size as canvas).
 */
export function inpaintMask(canvas, mask, opts = {}) {
  _telea(canvas, mask, opts.radius ?? 8);
  // Find bounding box of mask for feathering
  let mx1 = canvas.width, my1 = canvas.height, mx2 = 0, my2 = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const px = i % canvas.width, py = Math.floor(i / canvas.width);
    if (px < mx1) mx1 = px; if (px > mx2) mx2 = px;
    if (py < my1) my1 = py; if (py > my2) my2 = py;
  }
  if (mx2 > mx1) _featherBorder(canvas, mx1, my1, mx2-mx1, my2-my1, opts.feather ?? 3);
}

// ── TELEA-LITE ─────────────────────────────────────────────
// Iterative inward fill using Fast Marching Method (simplified)
function _telea(canvas, mask, radius) {
  const ctx   = canvas.getContext('2d', { willReadFrequently: true });
  const W     = canvas.width, H = canvas.height;
  const imgD  = ctx.getImageData(0, 0, W, H);
  const data  = imgD.data;

  // BFS order: process pixels from the border of the mask inward
  // Step 1: Find border pixels (masked pixel adjacent to non-masked)
  const order = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const px = i % W, py = Math.floor(i / W);
    if (_hasUnmaskedNeighbor(mask, px, py, W, H)) order.push(i);
  }

  // Step 2: fill border pixels first, then expand
  const MAX_PASSES = Math.ceil(radius / 2);
  const filled = new Uint8Array(W * H);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const nextBorder = [];

    for (const idx of order) {
      const px = idx % W, py = Math.floor(idx / W);
      if (filled[idx]) continue;

      // Gather nearby known pixels
      let rSum = 0, gSum = 0, bSum = 0, wSum = 0;

      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
          const ni = ny * W + nx;
          if (mask[ni] && !filled[ni]) continue;  // skip unfilled masked pixels

          const dist = Math.sqrt(dx*dx + dy*dy);
          if (dist > radius || dist === 0) continue;

          const w = 1 / (dist * dist + 0.001);
          const pi = ni * 4;
          rSum += data[pi]   * w;
          gSum += data[pi+1] * w;
          bSum += data[pi+2] * w;
          wSum += w;
        }
      }

      if (wSum > 0) {
        const pi = idx * 4;
        data[pi]   = Math.round(rSum / wSum);
        data[pi+1] = Math.round(gSum / wSum);
        data[pi+2] = Math.round(bSum / wSum);
        data[pi+3] = 255;
        filled[idx] = 1;
      }
    }

    // Expand: previously filled pixels' masked neighbors become new border
    for (const idx of order) {
      if (!filled[idx]) continue;
      const px = idx % W, py = Math.floor(idx / W);
      for (const [nx, ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (mask[ni] && !filled[ni]) nextBorder.push(ni);
      }
    }

    for (const ni of nextBorder) order.push(ni);

    // If all masked pixels are filled, stop
    if (order.every(i => filled[i] || !mask[i])) break;
  }

  // Final pass: fill any remaining masked pixels with simple neighbor average
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || filled[i]) continue;
    const px = i % W, py = Math.floor(i / W);
    let r = 0, g = 0, b = 0, n = 0;
    for (const [nx, ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
      const ni = (ny * W + nx) * 4;
      r += data[ni]; g += data[ni+1]; b += data[ni+2]; n++;
    }
    if (n) {
      const pi = i * 4;
      data[pi] = r/n; data[pi+1] = g/n; data[pi+2] = b/n; data[pi+3] = 255;
    }
  }

  ctx.putImageData(imgD, 0, 0);
}

function _hasUnmaskedNeighbor(mask, px, py, W, H) {
  for (const [nx, ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
    if (!mask[ny * W + nx]) return true;
  }
  return false;
}

// ── PATCH FILL ─────────────────────────────────────────────
// For larger regions: find the most similar patch outside the region
function _patchFill(canvas, rx, ry, rw, rh, searchRadius) {
  const ctx   = canvas.getContext('2d', { willReadFrequently: true });
  const W     = canvas.width, H = canvas.height;
  const PATCH = 8;  // patch size

  // Sample several patches from outside the region to find good matches
  const sourcePatches = [];
  const SAMPLE_COUNT  = 20;

  for (let attempt = 0; attempt < 200 && sourcePatches.length < SAMPLE_COUNT; attempt++) {
    // Random position in the search area, outside the inpaint region
    const sx = rx + Math.floor(Math.random() * (rw + searchRadius * 2)) - searchRadius;
    const sy = ry + Math.floor(Math.random() * (rh + searchRadius * 2)) - searchRadius;

    if (sx < 0 || sy < 0 || sx + PATCH > W || sy + PATCH > H) continue;
    // Must not overlap with the region
    if (sx < rx + rw && sx + PATCH > rx && sy < ry + rh && sy + PATCH > ry) continue;

    sourcePatches.push({ sx, sy });
  }

  if (!sourcePatches.length) return; // can't find source patches

  // Fill the region column by column using nearest patch
  const imgD = ctx.getImageData(0, 0, W, H);
  const data = imgD.data;

  for (let py = ry; py < ry + rh; py += PATCH) {
    for (let px = rx; px < rx + rw; px += PATCH) {
      // Find best matching patch
      let bestSx = sourcePatches[0].sx, bestSy = sourcePatches[0].sy;
      let bestScore = Infinity;

      for (const { sx, sy } of sourcePatches) {
        // Simple color distance on a 2x2 sample
        let score = 0;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const pi1 = ((py + dy) * W + (px + dx)) * 4;
            const pi2 = ((sy + dy) * W + (sx + dx)) * 4;
            if (pi1 < 0 || pi2 < 0) continue;
            score += Math.abs(data[pi1] - data[pi2]) +
                     Math.abs(data[pi1+1] - data[pi2+1]) +
                     Math.abs(data[pi1+2] - data[pi2+2]);
          }
        }
        if (score < bestScore) { bestScore = score; bestSx = sx; bestSy = sy; }
      }

      // Copy patch
      for (let dy = 0; dy < PATCH && py + dy < ry + rh; dy++) {
        for (let dx = 0; dx < PATCH && px + dx < rx + rw; dx++) {
          const dst = ((py + dy) * W + (px + dx)) * 4;
          const src = ((bestSy + dy) * W + (bestSx + dx)) * 4;
          data[dst]   = data[src];
          data[dst+1] = data[src+1];
          data[dst+2] = data[src+2];
          data[dst+3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgD, 0, 0);
}

// ── FEATHER (soften the inpaint boundary) ─────────────────
function _featherBorder(canvas, x, y, w, h, featherPx) {
  if (featherPx <= 0) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.save();
  // Create a soft mask: redraw the inpainted area with a blurred version of itself
  const tmp = Object.assign(document.createElement('canvas'), { width: canvas.width, height: canvas.height });
  const tCtx = tmp.getContext('2d');
  tCtx.filter = `blur(${featherPx}px)`;
  tCtx.drawImage(canvas, 0, 0);

  // Composite the blurred version only at the border (4px ring)
  const RING = featherPx + 1;
  ctx.filter = `blur(${Math.ceil(featherPx/2)}px)`;
  ctx.drawImage(tmp,
    Math.max(0, x - RING), Math.max(0, y - RING),
    Math.min(w + RING*2, canvas.width), Math.min(h + RING*2, canvas.height),
    Math.max(0, x - RING), Math.max(0, y - RING),
    Math.min(w + RING*2, canvas.width), Math.min(h + RING*2, canvas.height));
  ctx.restore();
}
