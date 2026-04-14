/**
 * ocr.js — OCR via Tesseract.js v4 (carregado via <script> tag como window.Tesseract)
 *
 * API correta do Tesseract.js v4:
 *   const worker = await Tesseract.createWorker({ logger })
 *   await worker.loadLanguage(lang)
 *   await worker.initialize(lang)
 *   await worker.setParameters({...})
 *   const { data } = await worker.recognize(image)
 *   await worker.terminate()
 *
 * A API ESM/v5 tem outra assinatura — não misturar.
 */

/** Aguarda window.Tesseract estar disponível */
function waitForTesseract(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const t0 = Date.now();
    const id = setInterval(() => {
      if (window.Tesseract) { clearInterval(id); resolve(window.Tesseract); }
      else if (Date.now() - t0 > timeoutMs) { clearInterval(id); reject(new Error('Tesseract.js não carregou. Verifique sua conexão.')); }
    }, 150);
  });
}

/**
 * Executa OCR em um HTMLCanvasElement.
 * @param {HTMLCanvasElement} canvas
 * @param {string} lang - 'jpn' | 'eng' | 'chi_sim' | 'kor'
 * @param {(pct:number, msg:string)=>void} onProgress
 * @returns {Promise<OcrBlock[]>}
 */
export async function runOCR(canvas, lang = 'jpn', onProgress = () => {}) {
  const T = await waitForTesseract();

  onProgress(5, 'Iniciando Tesseract…');

  let worker;
  try {
    // Tesseract.js v4 createWorker aceita opções como primeiro argumento
    worker = await T.createWorker({
      logger(m) {
        if (m.status === 'loading tesseract core')
          onProgress(8, 'Carregando núcleo OCR…');
        else if (m.status === 'loading language traineddata')
          onProgress(14, `Baixando dados: ${lang} (pode demorar na 1ª vez)…`);
        else if (m.status === 'initializing tesseract')
          onProgress(17, 'Inicializando Tesseract…');
        else if (m.status === 'initializing api')
          onProgress(19, 'Inicializando API…');
        else if (m.status === 'recognizing text')
          onProgress(22 + Math.round(m.progress * 68), 'Reconhecendo texto…');
      },
    });

    onProgress(11, `Carregando idioma: ${lang}…`);
    await worker.loadLanguage(lang);

    onProgress(18, 'Inicializando…');
    await worker.initialize(lang);

    // PSM 11 (sparse text) é melhor para mangá:
    // detecta texto fragmentado em múltiplos balões sem esperar layout contínuo.
    await worker.setParameters({ tessedit_pageseg_mode: '11' });

    onProgress(22, 'Analisando imagem…');

    // Passar dataURL é mais compatível que passar o canvas diretamente
    const imageData = canvas.toDataURL('image/png');
    const { data } = await worker.recognize(imageData);

    onProgress(92, 'Extraindo blocos…');
    const blocks = extractBlocks(data);

    onProgress(100, `Concluído — ${blocks.length} blocos`);
    return blocks;

  } finally {
    if (worker) {
      try { await worker.terminate(); } catch (_) {}
    }
  }
}

// ─────────────────────────────────────────
// Extração hierárquica: blocks → paragraphs → lines → words
// ─────────────────────────────────────────

function extractBlocks(data) {
  let items = [];
  let counter = 0;

  // Nível 1: blocos/parágrafos (ideal para balões completos)
  if (data.blocks?.length) {
    for (const tb of data.blocks) {
      for (const para of (tb.paragraphs || [])) {
        const text = clean(para.text);
        if (!text || para.confidence < 8) continue;
        const bb = para.bbox;
        if (!bb || bb.x1 - bb.x0 < 3 || bb.y1 - bb.y0 < 3) continue;
        items.push(makeBlock(counter++, text, bb, para.confidence));
      }
    }
  }

  // Nível 2: linhas (fallback)
  if (!items.length && data.lines?.length) {
    for (const line of data.lines) {
      const text = clean(line.text);
      if (!text || line.confidence < 8) continue;
      const bb = line.bbox;
      if (!bb || bb.x1 - bb.x0 < 3) continue;
      items.push(makeBlock(counter++, text, bb, line.confidence));
    }
  }

  // Nível 3: palavras agrupadas por proximidade (último recurso)
  if (!items.length && data.words?.length) {
    const words = data.words.filter(w => clean(w.text) && w.confidence > 8);
    items = clusterWords(words, counter);
  }

  return mergeVerticalNeighbors(items);
}

function makeBlock(id, text, bb, confidence) {
  return {
    id: `block-${id}`,
    text,
    bbox: { x: bb.x0, y: bb.y0, w: bb.x1 - bb.x0, h: bb.y1 - bb.y0 },
    confidence: Math.round(confidence),
    translation: '',
    visible: true,
    applied: false,
  };
}

function clean(t) {
  return (t || '').replace(/\s+/g, ' ').trim();
}

/**
 * Agrupa palavras em clusters baseados em proximidade espacial.
 * Heurística: palavras do mesmo balão de mangá ficam próximas e
 * têm alturas similares (mesmo tamanho de fonte).
 */
function clusterWords(words, startId) {
  const clusters = [];
  const used = new Set();

  for (let i = 0; i < words.length; i++) {
    if (used.has(i)) continue;
    const group = [words[i]];
    used.add(i);

    for (let j = i + 1; j < words.length; j++) {
      if (used.has(j)) continue;
      const a = group[group.length - 1];
      const b = words[j];
      const lineOverlap = Math.min(a.bbox.y1, b.bbox.y1) - Math.max(a.bbox.y0, b.bbox.y0);
      const hDist = b.bbox.x0 - a.bbox.x1;
      const vDist = Math.abs(b.bbox.y0 - a.bbox.y0);

      if ((lineOverlap > 0 && hDist < 60) || (vDist < 18 && hDist < 80)) {
        group.push(b);
        used.add(j);
      }
    }

    const xs = group.flatMap(w => [w.bbox.x0, w.bbox.x1]);
    const ys = group.flatMap(w => [w.bbox.y0, w.bbox.y1]);
    const conf = group.reduce((s, w) => s + w.confidence, 0) / group.length;
    const bb = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };

    clusters.push(makeBlock(startId++, clean(group.map(w => w.text).join(' ')), bb, conf));
  }
  return clusters;
}

/**
 * Mescla blocos adjacentes verticalmente com sobreposição horizontal,
 * para unir linhas do mesmo balão que o Tesseract separou.
 */
function mergeVerticalNeighbors(blocks, vGap = 28, hOverlapRatio = 0.25) {
  if (blocks.length < 2) return blocks;
  const out = [];
  const used = new Set();

  for (let i = 0; i < blocks.length; i++) {
    if (used.has(i)) continue;
    let cur = { ...blocks[i], bbox: { ...blocks[i].bbox } };

    for (let j = i + 1; j < blocks.length; j++) {
      if (used.has(j)) continue;
      const a = cur.bbox, b = blocks[j].bbox;
      const aR = a.x + a.w, bR = b.x + b.w;
      const overlapX = Math.min(aR, bR) - Math.max(a.x, b.x);
      const minW = Math.min(a.w, b.w);
      const gap = b.y - (a.y + a.h);

      if (overlapX / minW >= hOverlapRatio && gap >= 0 && gap <= vGap) {
        cur.text += '\n' + blocks[j].text;
        const nx = Math.min(a.x, b.x), ny = Math.min(a.y, b.y);
        cur.bbox = { x: nx, y: ny, w: Math.max(aR, bR) - nx, h: Math.max(a.y + a.h, b.y + b.h) - ny };
        cur.confidence = Math.min(cur.confidence, blocks[j].confidence);
        used.add(j);
      }
    }
    out.push(cur);
    used.add(i);
  }
  return out;
}
