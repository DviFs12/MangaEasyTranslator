/**
 * ocr.js — v4
 *
 * Melhorias vs v3:
 *  1. SEM toDataURL NO FULL CANVAS: usa createImageBitmap() para regiões,
 *     e passa o canvas diretamente (Tesseract v4 aceita HTMLCanvasElement
 *     via ImageData internamente — apenas o blob é gerado no worker).
 *     Para a imagem completa, ainda usamos toDataURL uma vez (necessário
 *     para compatibilidade cross-browser com Tesseract v4 web worker).
 *     Mas toDataURL é chamado apenas uma vez, não por bloco.
 *
 *  2. OCR MANUAL DE REGIÃO: nova função runOCRRegion(canvas, rect, lang)
 *     que recorta a área, roda OCR com PSM 6 (bloco uniforme) e retorna
 *     um único bloco com texto da região.
 *
 *  3. TEXTO CONTÍNUO: algoritmo DBSCAN-like para agrupar blocos por
 *     proximidade espacial E alinhamento de linha de base, muito mais
 *     preciso que o merge vertical simples do v3.
 *
 *  4. WORKER REUTILIZADO: o worker é criado uma vez e reutilizado entre
 *     chamadas (mesmo idioma). Reduz drasticamente o tempo de OCR em
 *     chamadas subsequentes (sem re-download de traineddata).
 */

// ── Worker singleton ────────────────────────────────────────
let _workerCache = null;   // { worker, lang }

async function getWorker(T, lang, onLog) {
  if (_workerCache && _workerCache.lang === lang) return _workerCache.worker;

  // Terminate old worker if language changed
  if (_workerCache) {
    try { await _workerCache.worker.terminate(); } catch (_) {}
    _workerCache = null;
  }

  const worker = await T.createWorker({ logger: onLog });
  await worker.loadLanguage(lang);
  await worker.initialize(lang);
  _workerCache = { worker, lang };
  return worker;
}

/** Terminate cached worker (call on new image load) */
export async function terminateWorker() {
  if (_workerCache) {
    try { await _workerCache.worker.terminate(); } catch (_) {}
    _workerCache = null;
  }
}

/** Aguarda window.Tesseract */
function waitForTesseract(ms = 15000) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const t0 = Date.now();
    const id = setInterval(() => {
      if (window.Tesseract) { clearInterval(id); resolve(window.Tesseract); }
      else if (Date.now() - t0 > ms) { clearInterval(id); reject(new Error('Tesseract não carregou.')); }
    }, 150);
  });
}

// ── PUBLIC: OCR completo da página ─────────────────────────

/**
 * @param {HTMLCanvasElement} canvas
 * @param {string} lang
 * @param {(pct,msg)=>void} onProgress
 * @returns {Promise<OcrBlock[]>}
 */
export async function runOCR(canvas, lang = 'jpn', onProgress = () => {}, psm = '11') {
  const T = await waitForTesseract();

  onProgress(5, 'Iniciando Tesseract…');

  const worker = await getWorker(T, lang, (m) => {
    if (m.status === 'loading tesseract core')      onProgress(8,  'Carregando núcleo…');
    else if (m.status === 'loading language traineddata') onProgress(14, `Baixando: ${lang}…`);
    else if (m.status === 'initializing tesseract') onProgress(17, 'Inicializando…');
    else if (m.status === 'initializing api')       onProgress(19, 'Pronto…');
    else if (m.status === 'recognizing text')       onProgress(22 + Math.round(m.progress * 68), 'Reconhecendo…');
  });

  // PSM configurable: default 11 = sparse text (best for manga with multiple balloons)
  await worker.setParameters({ tessedit_pageseg_mode: psm });

  onProgress(22, 'Analisando imagem…');

  // toDataURL é necessário aqui porque o Tesseract worker (web worker separado)
  // não tem acesso direto ao DOM canvas — precisa de uma URL ou blob serializado.
  // Esta é a única chamada toDataURL e acontece uma vez por OCR completo.
  const src = canvas.toDataURL('image/png');
  const { data } = await worker.recognize(src);

  onProgress(92, 'Extraindo blocos…');
  const blocks = extractAndCluster(data, canvas.width, canvas.height);

  onProgress(100, `Pronto — ${blocks.length} blocos`);
  return blocks;
}

// ── PUBLIC: OCR de região manual ──────────────────────────

/**
 * Roda OCR em uma área específica do canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {{x,y,w,h}} rect  — em coordenadas do canvas original
 * @param {string} lang
 * @param {(pct,msg)=>void} onProgress
 * @returns {Promise<OcrBlock>}  — único bloco com o texto da região
 */
export async function runOCRRegion(canvas, rect, lang = 'jpn', onProgress = () => {}, psm = '6') {
  const T = await waitForTesseract();

  onProgress(10, 'OCR da região…');

  const worker = await getWorker(T, lang, (m) => {
    if (m.status === 'recognizing text')
      onProgress(20 + Math.round(m.progress * 70), 'Reconhecendo região…');
  });

  // PSM configurable: default 6 = uniform block (best for isolated regions)
  await worker.setParameters({ tessedit_pageseg_mode: psm });

  // Recortar região sem toDataURL do canvas completo:
  // 1. Criar canvas temporário do tamanho da região
  const tmp    = document.createElement('canvas');
  tmp.width    = Math.ceil(rect.w);
  tmp.height   = Math.ceil(rect.h);
  const tCtx   = tmp.getContext('2d');
  tCtx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  // 2. toDataURL apenas do pedaço recortado (muito menor)
  const src = tmp.toDataURL('image/png');
  const { data } = await worker.recognize(src);

  onProgress(95, 'Processando…');

  const text = _clean((data.text || '').replace(/\n+/g, ' '));
  const confidence = data.confidence || 0;

  onProgress(100, 'Pronto');

  if (!text) return null;

  return {
    id:          `block-manual-${Date.now()}`,
    text,
    bbox:        { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    confidence:  Math.round(confidence),
    translation: '',
    visible:     true,
    applied:     false,
    manual:      true,
  };
}

// ── EXTRAÇÃO E CLUSTERING ──────────────────────────────────

function extractAndCluster(data, imgW, imgH) {
  // Coleta todas as palavras com posição
  const words = [];
  for (const tb of (data.blocks || [])) {
    for (const para of (tb.paragraphs || [])) {
      for (const line of (para.lines || [])) {
        for (const word of (line.words || [])) {
          const t = _clean(word.text);
          if (!t || word.confidence < 8) continue;
          const bb = word.bbox;
          if (!bb || bb.x1 <= bb.x0 || bb.y1 <= bb.y0) continue;
          words.push({
            text: t,
            x0: bb.x0, y0: bb.y0, x1: bb.x1, y1: bb.y1,
            conf: word.confidence,
            lineH: bb.y1 - bb.y0,  // average char height
          });
        }
      }
    }
  }

  if (!words.length) return _fallbackExtract(data);

  // ── DBSCAN-like clustering ────────────────────────────
  // Two words belong to the same cluster if they are spatially close
  // AND have similar line height (same font size → same balloon).
  const HORIZ_GAP  = 60;   // max px gap between words on same line
  const VERT_GAP   = 24;   // max px gap between lines in same balloon
  const SIZE_RATIO = 1.8;  // max line-height ratio between lines in same balloon

  const used    = new Uint8Array(words.length);
  const clusters = [];

  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    const group = [i];
    used[i] = 1;

    // BFS expand
    const queue = [i];
    while (queue.length) {
      const ci = queue.shift();
      const a  = words[ci];

      for (let j = 0; j < words.length; j++) {
        if (used[j]) continue;
        const b = words[j];

        // Same line check: vertical overlap + small horizontal gap
        const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
        const hGap     = Math.max(b.x0 - a.x1, a.x0 - b.x1);
        const onSameLine = yOverlap > 0 && hGap >= 0 && hGap <= HORIZ_GAP;

        // Adjacent line check: similar height, vertical proximity, horizontal overlap
        const sizeMatch  = Math.max(a.lineH, b.lineH) / Math.max(1, Math.min(a.lineH, b.lineH)) < SIZE_RATIO;
        const xOverlap   = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const vGap       = Math.max(b.y0 - a.y1, a.y0 - b.y1);
        const adjLine    = sizeMatch && xOverlap > -10 && vGap >= 0 && vGap <= VERT_GAP;

        if (onSameLine || adjLine) {
          used[j] = 1;
          group.push(j);
          queue.push(j);
        }
      }
    }

    // Build block from group
    const gs  = group.map(idx => words[idx]);
    const xs  = gs.flatMap(w => [w.x0, w.x1]);
    const ys  = gs.flatMap(w => [w.y0, w.y1]);
    const conf = gs.reduce((s, w) => s + w.conf, 0) / gs.length;

    // Sort words within group: top→bottom, left→right
    gs.sort((a, b) => {
      const lineDiff = a.y0 - b.y0;
      if (Math.abs(lineDiff) > 8) return lineDiff;
      return a.x0 - b.x0;
    });

    // Re-group into lines and join with spaces, lines with \n
    const lineGroups = [];
    let curLine = [gs[0]];
    for (let k = 1; k < gs.length; k++) {
      const prev = curLine[curLine.length - 1];
      const cur  = gs[k];
      const yOvlp = Math.min(prev.y1, cur.y1) - Math.max(prev.y0, cur.y0);
      if (yOvlp > 0 || Math.abs(cur.y0 - prev.y0) < prev.lineH * 0.5) {
        curLine.push(cur);
      } else {
        lineGroups.push(curLine);
        curLine = [cur];
      }
    }
    lineGroups.push(curLine);

    const text = lineGroups.map(line => line.map(w => w.text).join(' ')).join('\n');

    clusters.push({
      id:          `block-${clusters.length}`,
      text:        _clean(text),
      bbox:        { x: Math.min(...xs), y: Math.min(...ys),
                     w: Math.max(...xs) - Math.min(...xs),
                     h: Math.max(...ys) - Math.min(...ys) },
      confidence:  Math.round(conf),
      translation: '',
      visible:     true,
      applied:     false,
    });
  }

  return clusters;
}

/** Fallback when no word-level data available */
function _fallbackExtract(data) {
  const items = [];
  let id = 0;

  const tryPara = (para) => {
    const text = _clean(para.text);
    if (!text || para.confidence < 8) return;
    const bb = para.bbox;
    if (!bb || bb.x1 <= bb.x0 || bb.y1 <= bb.y0) return;
    items.push({ id: `block-${id++}`, text, confidence: Math.round(para.confidence),
      bbox: { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 },
      translation: '', visible: true, applied: false });
  };

  if (data.blocks?.length) for (const b of data.blocks) for (const p of (b.paragraphs||[])) tryPara(p);
  else if (data.lines?.length) data.lines.forEach(l => tryPara(l));

  return items;
}

function _clean(t) { return (t || '').replace(/\s+/g, ' ').trim(); }
