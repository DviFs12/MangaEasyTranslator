/**
 * app.js — Módulo principal. Orquestra todos os módulos.
 */

import { runOCR } from './ocr.js';
import { translateText, translateBatch } from './translate.js';
import { CanvasEditor } from './editor.js';
import { TextManager } from './textManager.js';
import {
  showToast, showLoading, updateLoading, hideLoading,
  setStep, setStatus, hideStatus,
  renderBlocksList, updateBlockCard, highlightBlockCard
} from './ui.js';

// ============================================================
// STATE
// ============================================================
const state = {
  image: null,           // HTMLImageElement
  blocks: [],            // Array<OCRBlock>
  selectedBlockId: null,
  zoom: 1,
  brushActive: false,
};

// ============================================================
// DOM REFS
// ============================================================
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const canvasWrapper = document.getElementById('canvas-wrapper');
const baseCanvas = document.getElementById('base-canvas');
const overlayCanvas = document.getElementById('overlay-canvas');
const textLayer = document.getElementById('text-layer');

const btnRunOCR = document.getElementById('btn-run-ocr');
const btnTranslateAll = document.getElementById('btn-translate-all');
const btnExport = document.getElementById('btn-export');
const btnNew = document.getElementById('btn-new');
const btnAddText = document.getElementById('btn-add-text');
const btnBrushTool = document.getElementById('btn-brush-tool');
const btnUndo = document.getElementById('btn-undo');
const btnFit = document.getElementById('btn-fit');
const btnZoomReset = document.getElementById('btn-zoom-reset');

const ocrLang = document.getElementById('ocr-lang');
const transLang = document.getElementById('trans-lang');
const zoomRange = document.getElementById('zoom-range');
const zoomVal = document.getElementById('zoom-val');
const brushSize = document.getElementById('brush-size');
const brushSizeVal = document.getElementById('brush-size-val');
const brushColor = document.getElementById('brush-color');
const brushModeButtons = document.querySelectorAll('[data-mode]');

const fontFamily = document.getElementById('font-family');
const fontSize = document.getElementById('font-size');
const textColor = document.getElementById('text-color');
const textBg = document.getElementById('text-bg');
const textBgOpacity = document.getElementById('text-bg-opacity');
const newTextInput = document.getElementById('new-text-input');
const alignBtns = document.querySelectorAll('[data-align]');

// ============================================================
// INIT MODULES
// ============================================================
const editor = new CanvasEditor(baseCanvas, overlayCanvas);
const textMgr = new TextManager(textLayer, canvasWrapper);

textMgr.onSelect = (id, data) => {
  state.selectedBlockId = id;
  highlightBlockCard(id);
};

// ============================================================
// IMAGE UPLOAD
// ============================================================
dropZone.addEventListener('click', (e) => {
  if (e.target.tagName !== 'BUTTON' && !e.target.closest('button')) return;
  fileInput.click();
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
  else showToast('Arquivo inválido. Use JPG, PNG ou WebP.', 'error');
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) loadImageFile(fileInput.files[0]);
});

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.image = img;
      editor.loadImage(img);
      canvasWrapper.classList.remove('hidden');
      dropZone.classList.add('hidden');
      btnRunOCR.disabled = false;
      btnAddText.disabled = false;
      fitCanvasToContainer();
      setStep(2);
      showToast('Imagem carregada! Clique em "Detectar Texto".', 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ============================================================
// OCR
// ============================================================
btnRunOCR.addEventListener('click', async () => {
  if (!state.image) return;
  const lang = ocrLang.value;

  showLoading('Iniciando OCR...', 0);
  btnRunOCR.disabled = true;
  setStep(2);

  try {
    state.blocks = await runOCR(
      baseCanvas,
      lang,
      (pct, msg) => updateLoading(msg, pct)
    );

    hideLoading();
    setStep(3);

    if (state.blocks.length === 0) {
      setStatus('ocr-status', 'Nenhum texto detectado. Tente outro idioma.', 'warning');
      showToast('Nenhum texto encontrado.', 'warning');
    } else {
      setStatus('ocr-status', `✓ ${state.blocks.length} blocos detectados.`, 'success');
      showToast(`${state.blocks.length} blocos de texto detectados!`, 'success');
    }

    editor.drawOverlay(state.blocks);
    renderBlocks();
    btnTranslateAll.disabled = state.blocks.length === 0;
    btnExport.disabled = false;

  } catch (err) {
    hideLoading();
    console.error('[OCR]', err);
    setStatus('ocr-status', `Erro: ${err.message}`, 'error');
    showToast('Erro no OCR: ' + err.message, 'error');
  } finally {
    btnRunOCR.disabled = false;
  }
});

// ============================================================
// TRANSLATION
// ============================================================
btnTranslateAll.addEventListener('click', async () => {
  if (!state.blocks.length) return;
  const srcLang = ocrLang.value;
  const tgtLang = transLang.value;

  btnTranslateAll.disabled = true;
  setStep(3);
  setStatus('trans-status', `Traduzindo ${state.blocks.length} blocos...`, 'info');

  // Marcar todos como "traduzindo"
  for (const b of state.blocks) b.translating = true;
  renderBlocks();

  let done = 0;
  const items = state.blocks.map(b => ({ id: b.id, text: b.text }));

  await translateBatch(items, srcLang, tgtLang, (id, result, error) => {
    const block = state.blocks.find(b => b.id === id);
    if (!block) return;
    block.translating = false;
    if (result) {
      block.translation = result.text;
      block.translatedBy = result.service;
    } else {
      block.translation = '';
      block.translationError = error?.message;
    }
    done++;
    updateBlockCard(block);
    updateLoading(`Traduzindo... ${done}/${state.blocks.length}`, (done / state.blocks.length) * 100);
  });

  hideLoading();
  setStep(4);
  const translated = state.blocks.filter(b => b.translation).length;
  setStatus('trans-status', `✓ ${translated}/${state.blocks.length} traduzidos.`, 'success');
  showToast(`Tradução concluída: ${translated} blocos.`, 'success');
  btnTranslateAll.disabled = false;
});

// ============================================================
// BLOCKS PANEL
// ============================================================
function renderBlocks() {
  renderBlocksList(state.blocks, {
    onSelect: (id) => selectBlock(id),
    onToggleVisibility: (id) => toggleBlockVisibility(id),
    onApplyTranslation: (id, text) => applyTranslation(id, text),
    onDelete: (id) => deleteBlock(id),
    onTranslationEdit: (id, text) => {
      const b = state.blocks.find(b => b.id === id);
      if (b) b.translation = text;
    },
  });
}

function selectBlock(id) {
  state.selectedBlockId = id;
  highlightBlockCard(id);
  editor.drawOverlay(state.blocks, id);
  // Scroll canvas para a bbox
  const block = state.blocks.find(b => b.id === id);
  if (block) scrollCanvasToBlock(block);
}

function toggleBlockVisibility(id) {
  const block = state.blocks.find(b => b.id === id);
  if (!block) return;
  block.visible = !block.visible;
  editor.drawOverlay(state.blocks, state.selectedBlockId);
  renderBlocks();
}

function deleteBlock(id) {
  state.blocks = state.blocks.filter(b => b.id !== id);
  textMgr.removeBox(id);
  editor.drawOverlay(state.blocks, state.selectedBlockId);
  renderBlocks();
}

function applyTranslation(id, text) {
  const block = state.blocks.find(b => b.id === id);
  if (!block || !text) return;

  const scale = getCanvasScale();
  const fSize = parseInt(fontSize.value) || 18;
  const ff = fontFamily.value;
  const tc = textColor.value;
  const bg = textBg.value;
  const bgOp = parseFloat(textBgOpacity.value);
  const al = document.querySelector('[data-align].active')?.dataset.align || 'center';

  // Apagar texto original automaticamente
  editor.fillRect(block.bbox.x, block.bbox.y, block.bbox.w, block.bbox.h, bg);

  textMgr.addBox({
    id,
    text,
    x: block.bbox.x,
    y: block.bbox.y,
    w: block.bbox.w,
    fontSize: fSize,
    fontFamily: ff,
    color: tc,
    bgColor: bg,
    bgOpacity: bgOp,
    align: al,
    scale,
  });

  block.applied = true;
  showToast('Tradução aplicada!', 'success');
}

function scrollCanvasToBlock(block) {
  const scale = getCanvasScale();
  const container = document.querySelector('.canvas-container');
  if (!container) return;
  container.scrollTo({
    left: block.bbox.x * scale - container.clientWidth / 2,
    top: block.bbox.y * scale - container.clientHeight / 2,
    behavior: 'smooth'
  });
}

// ============================================================
// BRUSH TOOLS
// ============================================================
btnBrushTool.addEventListener('click', () => {
  state.brushActive = !state.brushActive;
  btnBrushTool.dataset.active = state.brushActive;
  btnBrushTool.textContent = state.brushActive ? '🛑 Desativar Pincel' : '✏ Ativar Pincel';
  btnBrushTool.classList.toggle('active', state.brushActive);
  editor.activateBrush(state.brushActive);
  canvasWrapper.classList.toggle('brush-active', state.brushActive);
  if (state.brushActive) showToast('Pincel ativo! Pinte sobre o texto para apagá-lo.', 'info');
});

brushModeButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    brushModeButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    editor.setMode(btn.dataset.mode);
  });
});

brushSize.addEventListener('input', () => {
  brushSizeVal.textContent = brushSize.value;
  editor.setSize(parseInt(brushSize.value));
});

brushColor.addEventListener('input', () => editor.setColor(brushColor.value));

btnUndo.addEventListener('click', () => {
  if (editor.undo()) showToast('Ação desfeita.', 'info');
  else showToast('Nada para desfazer.', 'warning');
});

// ============================================================
// TEXT TOOL
// ============================================================
btnAddText.addEventListener('click', () => {
  const text = newTextInput.value.trim();
  if (!text) { showToast('Digite um texto primeiro.', 'warning'); return; }

  const id = `manual-${Date.now()}`;
  const scale = getCanvasScale();
  const al = document.querySelector('[data-align].active')?.dataset.align || 'center';

  textMgr.addBox({
    id,
    text,
    x: 50,
    y: 50,
    w: 150,
    fontSize: parseInt(fontSize.value) || 18,
    fontFamily: fontFamily.value,
    color: textColor.value,
    bgColor: textBg.value,
    bgOpacity: parseFloat(textBgOpacity.value),
    align: al,
    scale,
  });

  newTextInput.value = '';
  showToast('Texto adicionado! Arraste para posicionar.', 'success');
  btnExport.disabled = false;
});

// Alignment buttons
alignBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    alignBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    textMgr.updateSelected({ align: btn.dataset.align });
  });
});

// Font controls update selected text
fontFamily.addEventListener('change', () => textMgr.updateSelected({ fontFamily: fontFamily.value }));
fontSize.addEventListener('input', () => textMgr.updateSelected({ fontSize: parseInt(fontSize.value) }));
textColor.addEventListener('input', () => textMgr.updateSelected({ color: textColor.value }));
textBg.addEventListener('input', () => textMgr.updateSelected({ bgColor: textBg.value }));
textBgOpacity.addEventListener('input', () => textMgr.updateSelected({ bgOpacity: parseFloat(textBgOpacity.value) }));

// ============================================================
// ZOOM
// ============================================================
zoomRange.addEventListener('input', () => {
  const z = parseInt(zoomRange.value) / 100;
  setZoom(z);
});

btnFit.addEventListener('click', fitCanvasToContainer);
btnZoomReset.addEventListener('click', () => setZoom(1));

function setZoom(z) {
  state.zoom = z;
  zoomRange.value = Math.round(z * 100);
  zoomVal.textContent = Math.round(z * 100);
  canvasWrapper.style.transform = `scale(${z})`;
  canvasWrapper.style.transformOrigin = 'top left';
  textMgr.updateScale(z);
}

function fitCanvasToContainer() {
  if (!state.image) return;
  const container = document.querySelector('.canvas-container');
  const cw = container.clientWidth - 40;
  const ch = container.clientHeight - 40;
  const zw = cw / state.image.naturalWidth;
  const zh = ch / state.image.naturalHeight;
  setZoom(Math.min(zw, zh, 1));
}

function getCanvasScale() {
  return state.zoom;
}

// ============================================================
// EXPORT
// ============================================================
btnExport.addEventListener('click', async () => {
  showLoading('Exportando imagem...', 50);
  try {
    const scale = state.zoom;
    const dataUrl = await editor.exportImage(textLayer, scale);
    const link = document.createElement('a');
    link.download = `manga-traduzido-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
    setStep(5);
    hideLoading();
    showToast('Imagem exportada com sucesso!', 'success');
  } catch (err) {
    hideLoading();
    console.error('[export]', err);
    showToast('Erro ao exportar: ' + err.message, 'error');
  }
});

// ============================================================
// NEW IMAGE
// ============================================================
btnNew.addEventListener('click', () => {
  if (!confirm('Iniciar com nova imagem? O progresso atual será perdido.')) return;
  state.image = null;
  state.blocks = [];
  state.selectedBlockId = null;
  state.brushActive = false;

  editor.clearOverlay();
  textMgr.clear();
  renderBlocks();

  canvasWrapper.classList.add('hidden');
  dropZone.classList.remove('hidden');

  btnRunOCR.disabled = true;
  btnTranslateAll.disabled = true;
  btnExport.disabled = true;
  btnAddText.disabled = true;

  fileInput.value = '';
  setStep(1);
  hideStatus('ocr-status');
  hideStatus('trans-status');
});

// ============================================================
// KEYBOARD SHORTCUTS
// ============================================================
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (textMgr.selectedId) {
      textMgr.removeBox(textMgr.selectedId);
      showToast('Texto removido.', 'info');
    }
  }
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    editor.undo();
  }
  if (e.key === '+' || e.key === '=') {
    setZoom(Math.min(3, state.zoom + 0.1));
  }
  if (e.key === '-') {
    setZoom(Math.max(0.2, state.zoom - 0.1));
  }
  if (e.key === 'b' || e.key === 'B') {
    btnBrushTool.click();
  }
  if (e.key === 'Escape') {
    textMgr.deselect();
    if (state.brushActive) btnBrushTool.click();
  }
});

// ============================================================
// INIT
// ============================================================
setStep(1);
showToast('MangaEasyTranslator carregado! Faça upload de uma página de mangá.', 'info', 4000);
