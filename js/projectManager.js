/**
 * projectManager.js — v5
 *
 * Salva e carrega projetos no formato .met (JSON compactado).
 *
 * Estrutura do projeto:
 * {
 *   version: 5,
 *   timestamp: number,
 *   imageDataUrl: string,       // imagem base em base64
 *   inpaintDataUrl: string,     // camada de inpaint em base64
 *   blocks: OcrBlock[],         // blocos OCR + traduções
 *   textBoxes: TextBoxData[],   // caixas de texto aplicadas
 *   balloons: Balloon[],        // balões detectados
 *   meta: { lang, transLang }
 * }
 *
 * Persistência LOCAL: também salva no localStorage como backup automático.
 * O arquivo .met é oferecido para download para portabilidade.
 */

const LS_KEY    = 'met_autosave';
const VERSION   = 5;

/**
 * Serializa o estado atual em um objeto de projeto.
 */
export function buildProject({ baseCanvas, inpaintCanvas, blocks, textBoxes, balloons, meta }) {
  return {
    version:       VERSION,
    timestamp:     Date.now(),
    imageDataUrl:  baseCanvas.toDataURL('image/jpeg', 0.92),  // JPEG para reduzir tamanho
    inpaintDataUrl:inpaintCanvas.toDataURL('image/png'),
    blocks:        blocks.map(b => ({ ...b })),
    textBoxes:     textBoxes.map(t => ({ ...t })),
    balloons:      (balloons || []).map(b => ({ ...b })),
    meta,
  };
}

/**
 * Salva projeto como download de arquivo .met
 */
export function saveProjectFile(project) {
  const json = JSON.stringify(project);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const name = `manga-project-${new Date().toISOString().slice(0,10)}.met`;
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
}

/**
 * Salva cópia no localStorage (autosave).
 */
export function autosave(project) {
  try {
    // Limit stored size: drop imageDataUrl if too large
    const light = { ...project, imageDataUrl: project.imageDataUrl?.slice(0, 500000) ?? '' };
    localStorage.setItem(LS_KEY, JSON.stringify(light));
  } catch (e) {
    // QuotaExceededError — ignore
  }
}

/**
 * Retorna o último autosave se existir.
 */
export function getAutosave() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearAutosave() {
  try { localStorage.removeItem(LS_KEY); } catch (_) {}
}

/**
 * Carrega um projeto a partir de um File (.met).
 * @returns {Promise<object>} projeto parseado
 */
export async function loadProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try { resolve(JSON.parse(e.target.result)); }
      catch (err) { reject(new Error('Arquivo inválido: ' + err.message)); }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsText(file);
  });
}

/**
 * Restaura um projeto no app.
 * @param {object} project
 * @param {object} targets — { baseCanvas, inpaintCanvas }
 * @returns {Promise<{ image: HTMLImageElement, blocks, textBoxes, balloons, meta }>}
 */
export async function restoreProject(project, { baseCanvas, inpaintCanvas }) {
  if (!project?.version || project.version < 4) {
    throw new Error('Formato de projeto não suportado. Versão mínima: 4');
  }

  // Restore base image
  const img = await _loadImage(project.imageDataUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  baseCanvas.width = W; baseCanvas.height = H;
  baseCanvas.getContext('2d').drawImage(img, 0, 0);

  // Restore inpaint layer
  if (project.inpaintDataUrl) {
    try {
      const inpImg = await _loadImage(project.inpaintDataUrl);
      inpaintCanvas.width = W; inpaintCanvas.height = H;
      inpaintCanvas.getContext('2d').drawImage(inpImg, 0, 0);
    } catch (_) {
      inpaintCanvas.width = W; inpaintCanvas.height = H;
    }
  }

  return {
    image:    img,
    blocks:   project.blocks    || [],
    textBoxes:project.textBoxes || [],
    balloons: project.balloons  || [],
    meta:     project.meta      || {},
  };
}

function _loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src     = dataUrl;
  });
}
