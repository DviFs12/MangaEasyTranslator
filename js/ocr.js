/**
 * ocr.js — OCR module via Tesseract.js (CDN)
 * Detecta texto em imagens e retorna blocos com bounding boxes.
 */

const TESSERACT_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.5/tesseract.esm.min.js';

let Tesseract = null;

async function loadTesseract() {
  if (Tesseract) return Tesseract;
  const mod = await import(TESSERACT_CDN);
  Tesseract = mod;
  return Tesseract;
}

/**
 * Roda OCR em uma imagem (HTMLImageElement ou canvas ou dataURL).
 * @param {string|HTMLCanvasElement} imageSource
 * @param {string} lang - ex: 'jpn', 'eng'
 * @param {function} onProgress - callback(pct, msg)
 * @returns {Promise<Array>} Array de blocos { id, text, bbox: {x,y,w,h}, confidence }
 */
export async function runOCR(imageSource, lang = 'jpn', onProgress = () => {}) {
  const T = await loadTesseract();

  onProgress(5, 'Carregando motor OCR...');

  const worker = await T.createWorker(lang, 1, {
    workerPath: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.5/worker.min.js',
    corePath: 'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.0.5/tesseract-core-simd-lstm.wasm.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress(20 + Math.floor(m.progress * 70), 'Reconhecendo texto...');
      } else if (m.status === 'loading tesseract core') {
        onProgress(10, 'Carregando núcleo OCR...');
      } else if (m.status === 'loading language traineddata') {
        onProgress(15, `Carregando dados de idioma (${lang})...`);
      }
    }
  });

  // Para japonês, configurações especiais que melhoram resultados em mangá
  if (lang === 'jpn') {
    await worker.setParameters({
      tessedit_pageseg_mode: T.PSM.AUTO,
      preserve_interword_spaces: '1',
    });
  }

  onProgress(20, 'Analisando imagem...');

  const { data } = await worker.recognize(imageSource);
  await worker.terminate();

  onProgress(95, 'Processando resultados...');

  // Extrair blocos de texto com posição
  const blocks = extractTextBlocks(data);

  onProgress(100, 'OCR concluído!');
  return blocks;
}

/**
 * Extrai blocos de texto agrupados dos dados do Tesseract.
 * Tenta agrupar palavras em linhas/parágrafos com sentido.
 */
function extractTextBlocks(data) {
  const blocks = [];
  let idCounter = 0;

  // Nível de parágrafo é o melhor para mangá (balões completos)
  if (data.paragraphs && data.paragraphs.length > 0) {
    for (const para of data.paragraphs) {
      const text = para.text.trim();
      if (!text || text.length < 1) continue;
      if (para.confidence < 15) continue; // descarta confiança muito baixa

      const bbox = para.bbox;
      if (!bbox || (bbox.x1 - bbox.x0) < 5 || (bbox.y1 - bbox.y0) < 5) continue;

      blocks.push({
        id: `block-${idCounter++}`,
        text: cleanText(text),
        bbox: {
          x: bbox.x0,
          y: bbox.y0,
          w: bbox.x1 - bbox.x0,
          h: bbox.y1 - bbox.y0,
        },
        confidence: Math.round(para.confidence),
        translation: '',
        visible: true,
      });
    }
  }

  // Fallback: usar linhas se não há parágrafos
  if (blocks.length === 0 && data.lines) {
    for (const line of data.lines) {
      const text = line.text.trim();
      if (!text || text.length < 1) continue;
      if (line.confidence < 15) continue;

      const bbox = line.bbox;
      if (!bbox || (bbox.x1 - bbox.x0) < 5) continue;

      blocks.push({
        id: `block-${idCounter++}`,
        text: cleanText(text),
        bbox: {
          x: bbox.x0,
          y: bbox.y0,
          w: bbox.x1 - bbox.x0,
          h: bbox.y1 - bbox.y0,
        },
        confidence: Math.round(line.confidence),
        translation: '',
        visible: true,
      });
    }
  }

  // Mesclar blocos muito próximos (provável mesmo balão)
  return mergeNearbyBlocks(blocks);
}

/**
 * Limpa o texto OCR de artefatos comuns.
 */
function cleanText(text) {
  return text
    .replace(/\s+/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

/**
 * Mescla blocos que estão muito próximos verticalmente (mesmo balão).
 */
function mergeNearbyBlocks(blocks, threshold = 30) {
  if (blocks.length < 2) return blocks;

  const merged = [];
  const used = new Set();

  for (let i = 0; i < blocks.length; i++) {
    if (used.has(i)) continue;
    const a = blocks[i];
    let combined = { ...a, bbox: { ...a.bbox } };

    for (let j = i + 1; j < blocks.length; j++) {
      if (used.has(j)) continue;
      const b = blocks[j];

      // Verificar sobreposição horizontal e proximidade vertical
      const aRight = a.bbox.x + a.bbox.w;
      const bRight = b.bbox.x + b.bbox.w;
      const xOverlap = Math.min(aRight, bRight) - Math.max(a.bbox.x, b.bbox.x);
      const aBottom = a.bbox.y + a.bbox.h;
      const bTop = b.bbox.y;
      const vDist = bTop - aBottom;

      if (xOverlap > 0 && vDist > 0 && vDist < threshold) {
        // Mesclar
        combined.text = combined.text + '\n' + b.text;
        const newX = Math.min(combined.bbox.x, b.bbox.x);
        const newY = Math.min(combined.bbox.y, b.bbox.y);
        const newRight = Math.max(combined.bbox.x + combined.bbox.w, b.bbox.x + b.bbox.w);
        const newBottom = Math.max(combined.bbox.y + combined.bbox.h, b.bbox.y + b.bbox.h);
        combined.bbox = { x: newX, y: newY, w: newRight - newX, h: newBottom - newY };
        combined.confidence = Math.min(combined.confidence, b.confidence);
        used.add(j);
      }
    }

    merged.push(combined);
    used.add(i);
  }

  return merged;
}
