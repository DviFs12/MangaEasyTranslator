/**
 * balloonDetector.js — v5
 *
 * Detecta balões de fala usando OpenCV.js (contorno + análise morfológica).
 * Fallback automático para heurística pura em JS se OpenCV não estiver pronto.
 *
 * Técnica OpenCV:
 *  1. Converter para cinza
 *  2. Gaussian blur leve (reduz ruído de screentone)
 *  3. Threshold adaptativo → binariza texto/balões vs fundo
 *  4. Encontrar contornos externos
 *  5. Filtrar por: área mínima, aspect ratio razoável, convexidade
 *  6. Classificar tipo: speech (elipse/redondo), thought (irregular), box (retangular)
 *
 * O módulo exporta:
 *  detectBalloons(canvas) → Promise<Balloon[]>
 *  waitForOpenCV()        → Promise<boolean>
 *  isBalloonPoint(x,y,balloons) → boolean
 */

let _cvReady = false;
let _cvReadyPromise = null;

/** Aguarda OpenCV.js estar pronto. Timeout de 8s → usa fallback. */
export function waitForOpenCV(timeoutMs = 8000) {
  if (_cvReady) return Promise.resolve(true);
  if (_cvReadyPromise) return _cvReadyPromise;

  _cvReadyPromise = new Promise((resolve) => {
    if (typeof cv !== 'undefined' && cv.Mat) { _cvReady = true; return resolve(true); }

    const t0 = Date.now();
    const check = setInterval(() => {
      try {
        if (typeof cv !== 'undefined' && cv.Mat) {
          _cvReady = true; clearInterval(check); resolve(true);
        } else if (Date.now() - t0 > timeoutMs) {
          clearInterval(check); resolve(false); // use fallback
        }
      } catch (_) {
        if (Date.now() - t0 > timeoutMs) { clearInterval(check); resolve(false); }
      }
    }, 200);

    // Also listen for the opencv.js onRuntimeInitialized callback
    if (typeof Module !== 'undefined') {
      const orig = Module.onRuntimeInitialized;
      Module.onRuntimeInitialized = () => {
        if (orig) orig();
        _cvReady = true; clearInterval(check); resolve(true);
      };
    }
  });

  return _cvReadyPromise;
}

/**
 * @typedef {{ x:number, y:number, w:number, h:number, type:string, score:number }} Balloon
 */

/**
 * Detecta balões no canvas.
 * @param {HTMLCanvasElement} canvas
 * @returns {Promise<Balloon[]>}
 */
export async function detectBalloons(canvas) {
  const cvAvail = await waitForOpenCV(100); // short timeout — fall through fast if not ready
  if (cvAvail && _cvReady) {
    try { return _detectWithOpenCV(canvas); }
    catch (e) { console.warn('[balloon] OpenCV falhou, usando fallback:', e.message); }
  }
  return _detectFallback(canvas);
}

// ── OpenCV detection ───────────────────────────────────────
function _detectWithOpenCV(canvas) {
  const cv_ = cv; // local alias to avoid global shadowing issues
  const src  = cv_.imread(canvas);
  const gray = new cv_.Mat();
  const blur = new cv_.Mat();
  const bin  = new cv_.Mat();
  const hier = new cv_.Mat();
  const contours = new cv_.MatVector();

  cv_.cvtColor(src, gray, cv_.COLOR_RGBA2GRAY);
  cv_.GaussianBlur(gray, blur, new cv_.Size(3, 3), 0);

  // Adaptive threshold works better than Otsu for manga (varying background)
  cv_.adaptiveThreshold(blur, bin, 255, cv_.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv_.THRESH_BINARY_INV, 15, 4);

  // Close small gaps to join balloon borders
  const kernel = cv_.getStructuringElement(cv_.MORPH_RECT, new cv_.Size(3, 3));
  cv_.morphologyEx(bin, bin, cv_.MORPH_CLOSE, kernel);

  cv_.findContours(bin, contours, hier, cv_.RETR_EXTERNAL, cv_.CHAIN_APPROX_SIMPLE);

  const W = canvas.width, H = canvas.height;
  const minArea = (W * H) * 0.002;  // at least 0.2% of image
  const maxArea = (W * H) * 0.7;    // not the whole image

  const balloons = [];

  for (let i = 0; i < contours.size(); i++) {
    const cnt  = contours.get(i);
    const area = cv_.contourArea(cnt);

    if (area < minArea || area > maxArea) { cnt.delete(); continue; }

    const rect   = cv_.boundingRect(cnt);
    const aspect = rect.width / Math.max(1, rect.height);

    // Filter extreme aspect ratios
    if (aspect < 0.2 || aspect > 6) { cnt.delete(); continue; }

    // Convexity: ratio of contour area to its convex hull area
    const hull     = new cv_.Mat();
    cv_.convexHull(cnt, hull);
    const hullArea = cv_.contourArea(hull);
    const convex   = hullArea > 0 ? area / hullArea : 0;
    hull.delete();

    // Balloons are usually somewhat convex (> 0.4)
    if (convex < 0.35) { cnt.delete(); continue; }

    const type = _classifyBalloonCV(aspect, convex, area, W * H);

    balloons.push({
      x: rect.x, y: rect.y, w: rect.width, h: rect.height, type,
      score: Math.round(convex * 100) / 100,
    });
    cnt.delete();
  }

  // Cleanup
  src.delete(); gray.delete(); blur.delete(); bin.delete();
  hier.delete(); contours.delete(); kernel.delete();

  return _dedup(balloons);
}

function _classifyBalloonCV(aspect, convex, area, totalArea) {
  if (convex > 0.88 && aspect > 0.6 && aspect < 1.8) return 'speech';    // round
  if (aspect > 2.5 || area / totalArea > 0.08)        return 'narration'; // wide box
  if (convex < 0.6)                                    return 'thought';   // jagged
  return 'speech';
}

// ── Pure-JS fallback ───────────────────────────────────────
function _detectFallback(canvas) {
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  // Work at reduced resolution for speed
  const SCALE = Math.min(1, 640 / Math.max(W, H));
  const sw = Math.floor(W * SCALE), sh = Math.floor(H * SCALE);

  const tmp = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
  tmp.getContext('2d').drawImage(canvas, 0, 0, sw, sh);
  const px = tmp.getContext('2d').getImageData(0, 0, sw, sh).data;

  // Build lightness mask: pixels brighter than 220 (potential balloon interiors)
  const light = new Uint8Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) {
    const b = i * 4;
    const lum = 0.299 * px[b] + 0.587 * px[b+1] + 0.114 * px[b+2];
    light[i] = lum > 210 ? 1 : 0;
  }

  // Connected-component flood-fill to find light regions
  const visited  = new Uint8Array(sw * sh);
  const balloons = [];
  const MIN_PX   = sw * sh * 0.002;

  for (let sy = 2; sy < sh - 2; sy += 3) {
    for (let sx = 2; sx < sw - 2; sx += 3) {
      const idx = sy * sw + sx;
      if (visited[idx] || !light[idx]) continue;

      let minX = sx, maxX = sx, minY = sy, maxY = sy, count = 0;
      const q = [idx];
      visited[idx] = 1;

      while (q.length && count < 40000) {
        const pos = q.pop(); count++;
        const px2 = pos % sw, py2 = Math.floor(pos / sw);
        if (px2 < minX) minX = px2; if (px2 > maxX) maxX = px2;
        if (py2 < minY) minY = py2; if (py2 > maxY) maxY = py2;

        for (const [nx, ny] of [[px2-2,py2],[px2+2,py2],[px2,py2-2],[px2,py2+2]]) {
          if (nx < 0 || nx >= sw || ny < 0 || ny >= sh) continue;
          const ni = ny * sw + nx;
          if (!visited[ni] && light[ni]) { visited[ni] = 1; q.push(ni); }
        }
      }

      if (count < MIN_PX) continue;

      const bw = maxX - minX, bh = maxY - minY;
      const aspect = bw / Math.max(1, bh);
      if (aspect < 0.2 || aspect > 7) continue;

      // Scale back to original coords
      balloons.push({
        x: Math.floor(minX / SCALE), y: Math.floor(minY / SCALE),
        w: Math.ceil(bw / SCALE),    h: Math.ceil(bh / SCALE),
        type: aspect > 2.5 ? 'narration' : 'speech',
        score: 0.5,
      });
    }
  }

  return _dedup(balloons);
}

// ── Utilities ─────────────────────────────────────────────
function _dedup(balloons) {
  const out = [];
  for (const b of balloons) {
    const dup = out.find(a => _iou(a, b) > 0.45);
    if (!dup) out.push(b);
    else if (b.w * b.h > dup.w * dup.h) Object.assign(dup, b);
  }
  return out;
}

function _iou(a, b) {
  const ix = Math.max(0, Math.min(a.x+a.w, b.x+b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y+a.h, b.y+b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  if (!inter) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/**
 * Check if a canvas point (x, y) is inside any balloon.
 */
export function isBalloonPoint(x, y, balloons) {
  return balloons.some(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
}

/**
 * Find which balloon (if any) contains center of a bbox.
 */
export function findBalloonForBlock(block, balloons) {
  const cx = block.bbox.x + block.bbox.w / 2;
  const cy = block.bbox.y + block.bbox.h / 2;
  return balloons.find(b => cx >= b.x && cx <= b.x+b.w && cy >= b.y && cy <= b.y+b.h) ?? null;
}
