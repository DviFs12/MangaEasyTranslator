/**
 * app.js — Orquestrador principal v3
 *
 * Fluxo:
 *  Upload → OCR → Tradução → Edição (ferramentas + caixas) → Exportar
 */

import { runOCR }            from './ocr.js';
import { translateBatch }    from './translate.js';
import { CanvasEditor } from './editor.js';
import { TextManager }       from './textManager.js';
import { pickFont, pickFontSize, FONTS } from './fontManager.js';
import {
  toast, showLoading, updateLoading, hideLoading,
  setStep, setStatus, clearStatus,
  renderBlocks, updateBlockCard, highlightBlock,
} from './ui.js';

// ═══════════════════════════════════════════════════════════════
// DOM
// ═══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

const dropZone   = $('drop-zone');
const fileInput  = $('file-input');
const stage      = $('canvas-stage');
const world      = $('canvas-world');
const baseCanvas = $('base-canvas');
const selCanvas  = $('selection-canvas');
const ovrCanvas  = $('overlay-canvas');
const prvCanvas  = $('preview-canvas');
const textLayer  = $('text-layer');

// Buttons
const btnRunOCR      = $('btn-run-ocr');
const btnTranslate   = $('btn-translate-all');
const btnExport      = $('btn-export');
const btnNew         = $('btn-new');
const btnAddText     = $('btn-add-text');
const btnUndo        = $('btn-undo');
const btnRedo        = $('btn-redo');
const btnClearSel    = $('btn-clear-sel');
const btnFit         = $('btn-fit');
const btnZoomReset   = $('btn-zoom-reset');
const btnDeleteBox   = $('btn-delete-box');
const btnSelectFile  = $('btn-select-file');

// Tool buttons
const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');

// Inputs
const ocrLang   = $('ocr-lang');
const transLang = $('trans-lang');
const zoomRange = $('zoom-range');
const zoomVal   = $('zoom-val');
const newTextIn = $('new-text-input');

// Box editor
const boxEditor    = $('box-editor');
const boxText      = $('box-text');
const boxFontFam   = $('box-font-family');
const boxFontSize  = $('box-font-size');
const boxColor     = $('box-color');
const boxBg        = $('box-bg');
const boxOpacity   = $('box-opacity');
const boxOpacityV  = $('box-opacity-val');
const boxRotation  = $('box-rotation');
const boxRotationV = $('box-rotation-val');
const alignBtns    = document.querySelectorAll('.align-btn');

// Populate font select from catalog
if (boxFontFam) {
  boxFontFam.innerHTML = FONTS.map(f => `<option value="${f.name}">${f.label}</option>`).join('');
}

// ═══════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════
const state = {
  image:        null,
  blocks:       [],
  selectedBlock: null,
};

// ═══════════════════════════════════════════════════════════════
// MODULES
// ═══════════════════════════════════════════════════════════════
const editor = new CanvasEditor({
  stage, world,
  base:      baseCanvas,
  selection: selCanvas,
  overlay:   ovrCanvas,
});

const textMgr = new TextManager(textLayer, prvCanvas);

// Sync zoom UI on wheel
editor.onZoomChange = (s) => syncZoomUI(s);

// On selection changed: show/hide clear button
editor.onSelectionChange = (rect) => {
  if (btnClearSel) btnClearSel.classList.toggle('hidden', !rect);
};

// TextManager callbacks → populate box-editor panel
textMgr.onSelect = (id, data) => {
  state.selectedBlock = id;
  highlightBlock(id);
  if (boxEditor) boxEditor.style.display = '';
  populateBoxEditor(data);
};
textMgr.onDeselect = () => {
  if (boxEditor) boxEditor.style.display = 'none';
  state.selectedBlock = null;
};

// ═══════════════════════════════════════════════════════════════
// UPLOAD
// ═══════════════════════════════════════════════════════════════
if (btnSelectFile) btnSelectFile.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('click', (e) => {
  if (e.target === btnSelectFile || e.target.closest('#btn-select-file')) return; // handled above
  if (e.target.closest('.drop-content')) fileInput.click();
});
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.type.startsWith('image/')) loadFile(f);
  else toast('Use JPG, PNG ou WebP.', 'error');
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

function loadFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = () => {
      state.image  = img;
      state.blocks = [];

      editor.loadImage(img);

      // Sync all canvas layers & preview size
      [selCanvas, ovrCanvas, prvCanvas].forEach(c => {
        c.width = img.naturalWidth; c.height = img.naturalHeight;
      });
      textMgr.syncPreviewSize(img.naturalWidth, img.naturalHeight);

      // Show stage
      stage.style.display = '';
      dropZone.style.display = 'none';

      // Fit
      const s = editor.fitToStage(img.naturalWidth, img.naturalHeight);
      syncZoomUI(s);

      btnRunOCR.disabled  = false;
      btnAddText.disabled = false;
      btnExport.disabled  = false;
      setStep(2);
      toast('Imagem carregada! Clique em "Detectar Texto".', 'success');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ═══════════════════════════════════════════════════════════════
// OCR
// ═══════════════════════════════════════════════════════════════
btnRunOCR.addEventListener('click', async () => {
  if (!state.image) return;
  btnRunOCR.disabled = true;
  showLoading('Inicializando OCR…', 0, 'Pode demorar na 1ª vez (download de dados)');
  setStep(2);

  try {
    state.blocks = await runOCR(
      baseCanvas,
      ocrLang.value,
      (pct, msg) => updateLoading(msg, pct),
    );

    hideLoading();
    setStep(3);

    if (!state.blocks.length) {
      setStatus('ocr-status', 'Nenhum texto detectado. Tente outro idioma ou imagem mais nítida.', 'warning');
      toast('Nenhum texto encontrado.', 'warning');
    } else {
      setStatus('ocr-status', `✓ ${state.blocks.length} blocos detectados.`, 'success');
      toast(`${state.blocks.length} blocos detectados!`, 'success');
      btnTranslate.disabled = false;
    }

    editor.drawOverlay(state.blocks);
    renderBlockList();

  } catch (err) {
    hideLoading();
    console.error('[OCR]', err);
    setStatus('ocr-status', `Erro: ${err.message}`, 'error');
    toast('Erro OCR: ' + err.message, 'error');
  } finally {
    btnRunOCR.disabled = false;
  }
});

// ═══════════════════════════════════════════════════════════════
// TRANSLATION
// ═══════════════════════════════════════════════════════════════
btnTranslate.addEventListener('click', async () => {
  if (!state.blocks.length) return;
  btnTranslate.disabled = true;
  setStep(3);
  showLoading('Traduzindo…', 0, `${state.blocks.length} blocos`);

  state.blocks.forEach(b => { b.translating = true; });
  renderBlockList();

  let done = 0;
  await translateBatch(
    state.blocks.map(b => ({ id: b.id, text: b.text })),
    ocrLang.value,
    transLang.value,
    (id, result, err) => {
      const b = state.blocks.find(x => x.id === id);
      if (!b) return;
      b.translating = false;
      if (result) { b.translation = result.text; b.translatedBy = result.service; }
      else        { b.translationError = err?.message; }
      done++;
      updateBlockCard(b);
      updateLoading(`Traduzindo… ${done}/${state.blocks.length}`, (done / state.blocks.length) * 100);
    },
  );

  hideLoading();
  setStep(4);
  const ok = state.blocks.filter(b => b.translation).length;
  setStatus('trans-status', `✓ ${ok}/${state.blocks.length} traduzidos.`, 'success');
  toast(`Tradução: ${ok} blocos OK.`, 'success');
  btnTranslate.disabled = false;
  renderBlockList();
});

// ═══════════════════════════════════════════════════════════════
// BLOCK LIST CALLBACKS
// ═══════════════════════════════════════════════════════════════
function renderBlockList() {
  renderBlocks(state.blocks, {
    onSelect:          (id) => selectBlock(id),
    onToggleVis:       (id) => { const b = state.blocks.find(x => x.id === id); if (b) { b.visible = !b.visible; editor.drawOverlay(state.blocks, state.selectedBlock); renderBlockList(); } },
    onErase:           (id) => eraseBlockArea(id),
    onDelete:          (id) => deleteBlock(id),
    onApply:           (id, text) => applyTranslation(id, text),
    onTranslationEdit: (id, text) => { const b = state.blocks.find(x => x.id === id); if (b) b.translation = text; },
  });
}

function selectBlock(id) {
  state.selectedBlock = id;
  highlightBlock(id);
  editor.drawOverlay(state.blocks, id);
  scrollToBlock(state.blocks.find(b => b.id === id));
}

function deleteBlock(id) {
  state.blocks = state.blocks.filter(b => b.id !== id);
  textMgr.remove(id);
  editor.drawOverlay(state.blocks, state.selectedBlock);
  renderBlockList();
}

function eraseBlockArea(id) {
  const b = state.blocks.find(x => x.id === id);
  if (!b) return;
  const bg = boxBg?.value || '#ffffff';
  editor.fillRect(b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h, bg);
  toast('Área apagada.', 'info');
}

function applyTranslation(id, text) {
  const b = state.blocks.find(x => x.id === id);
  if (!b || !text) { toast('Texto de tradução vazio.', 'warning'); return; }

  const font  = pickFont(b);
  const fSize = pickFontSize(text, b.bbox, font);
  const bg    = boxBg?.value    || '#ffffff';
  const bgOp  = (boxOpacity?.value ?? 90) / 100;
  const color = boxColor?.value || '#000000';

  // 1. Apagar texto original
  editor.fillRect(b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h, bg);

  // 2. Criar caixa de tradução
  textMgr.add({
    id,
    text,
    x:          b.bbox.x + 2,
    y:          b.bbox.y + 2,
    w:          Math.max(b.bbox.w - 4, 60),
    h:          b.bbox.h,
    fontSize:   fSize,
    fontFamily: font,
    color,
    bgColor:    bg,
    bgOpacity:  bgOp,
    align:      'center',
  });

  b.applied = true;
  editor.drawOverlay(state.blocks, state.selectedBlock);
  renderBlockList();
  toast(`Aplicado (${font}, ${fSize}px)`, 'success');
}

function scrollToBlock(block) {
  if (!block) return;
  const cx = block.bbox.x + block.bbox.w / 2;
  const cy = block.bbox.y + block.bbox.h / 2;
  editor.panToCenter(cx, cy);
}

// ═══════════════════════════════════════════════════════════════
// DRAWING TOOLS
// ═══════════════════════════════════════════════════════════════
toolBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tool = btn.dataset.tool;
    const wasActive = btn.classList.contains('active');

    // Deactivate all
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null);

    if (!wasActive) {
      btn.classList.add('active');
      editor.setTool(tool);
      renderToolOptions(tool);
      toast(`Ferramenta: ${btn.textContent.trim()}`, 'info', 1800);
    } else {
      renderToolOptions(null);
    }
  });
});

function renderToolOptions(tool) {
  const opts = $('tool-options');
  if (!opts) return;
  opts.innerHTML = '';

  if (!tool || tool === 'selection') return;

  const sizeRow = document.createElement('div');
  sizeRow.className = 'tool-group';
  sizeRow.innerHTML = `
    <label class="tool-label">Tamanho: <span id="t-size-val">20</span>px</label>
    <input type="range" id="t-size" min="3" max="120" value="20" class="tool-range" />
  `;
  opts.appendChild(sizeRow);

  if (tool === 'brush' || tool === 'fill') {
    const colorRow = document.createElement('div');
    colorRow.className = 'tool-group';
    colorRow.innerHTML = `<label class="tool-label">Cor</label><input type="color" id="t-color" value="#ffffff" class="tool-color" />`;
    opts.appendChild(colorRow);
    const colorInp = opts.querySelector('#t-color');
    colorInp?.addEventListener('input', () => editor.setToolColor(colorInp.value));
  }

  if (tool === 'clone') {
    const hint = document.createElement('p');
    hint.className = 'tip-text';
    hint.textContent = 'Ctrl+click = define origem. Click = clona.';
    opts.appendChild(hint);
    editor.toast = toast; // pass toast reference for clone feedback
  }

  const sizeInp = opts.querySelector('#t-size');
  const sizeV   = opts.querySelector('#t-size-val');
  if (sizeInp) {
    sizeInp.addEventListener('input', () => {
      editor.setToolSize(+sizeInp.value);
      if (sizeV) sizeV.textContent = sizeInp.value;
    });
  }
}

// Fill selection with color
btnClearSel?.addEventListener('click', () => {
  editor.clearSelection();
  btnClearSel.classList.add('hidden');
});

// ═══════════════════════════════════════════════════════════════
// UNDO / REDO
// ═══════════════════════════════════════════════════════════════
btnUndo?.addEventListener('click', () => { if (editor.undo()) toast('Desfeito.', 'info'); else toast('Nada para desfazer.', 'warning'); });
btnRedo?.addEventListener('click', () => { if (editor.redo()) toast('Refeito.',  'info'); else toast('Nada para refazer.',  'warning'); });

// ═══════════════════════════════════════════════════════════════
// TEXT MANUAL
// ═══════════════════════════════════════════════════════════════
btnAddText?.addEventListener('click', () => {
  const text = newTextIn?.value.trim();
  if (!text) { toast('Digite o texto.', 'warning'); return; }
  textMgr.add({
    text,
    x:          Math.floor(baseCanvas.width  * 0.05),
    y:          Math.floor(baseCanvas.height * 0.05),
    w:          Math.floor(baseCanvas.width  * 0.3),
    fontSize:   +boxFontSize?.value || 18,
    fontFamily: boxFontFam?.value   || 'Bangers',
    color:      boxColor?.value     || '#000000',
    bgColor:    boxBg?.value        || '#ffffff',
    bgOpacity:  (boxOpacity?.value ?? 90) / 100,
    align:      document.querySelector('.align-btn.active')?.dataset.align || 'center',
  });
  if (newTextIn) newTextIn.value = '';
  toast('Texto adicionado. Arraste para posicionar.', 'success');
});

// ═══════════════════════════════════════════════════════════════
// BOX EDITOR PANEL (live update selected box)
// ═══════════════════════════════════════════════════════════════
function populateBoxEditor(data) {
  if (boxText)     boxText.value    = data.text;
  if (boxFontFam)  boxFontFam.value = data.fontFamily;
  if (boxFontSize) boxFontSize.value= data.fontSize;
  if (boxColor)    boxColor.value   = data.color;
  if (boxBg)       boxBg.value      = data.bgColor;
  if (boxOpacity)  { boxOpacity.value = Math.round(data.bgOpacity * 100); if (boxOpacityV) boxOpacityV.textContent = boxOpacity.value; }
  if (boxRotation) { boxRotation.value = data.rotation; if (boxRotationV) boxRotationV.textContent = data.rotation; }
  alignBtns.forEach(b => b.classList.toggle('active', b.dataset.align === data.align));
}

// Debounce helper for text input
let _textDebounce;
boxText?.addEventListener('input', () => {
  clearTimeout(_textDebounce);
  _textDebounce = setTimeout(() => textMgr.updateSelected({ text: boxText.value }), 60);
});

boxFontFam?.addEventListener('change',  () => textMgr.updateSelected({ fontFamily: boxFontFam.value }));
boxFontSize?.addEventListener('input',  () => textMgr.updateSelected({ fontSize: +boxFontSize.value || 18 }));
boxColor?.addEventListener('input',     () => textMgr.updateSelected({ color: boxColor.value }));
boxBg?.addEventListener('input',        () => textMgr.updateSelected({ bgColor: boxBg.value }));
boxOpacity?.addEventListener('input',   () => {
  if (boxOpacityV) boxOpacityV.textContent = boxOpacity.value;
  textMgr.updateSelected({ bgOpacity: boxOpacity.value / 100 });
});
boxRotation?.addEventListener('input',  () => {
  if (boxRotationV) boxRotationV.textContent = boxRotation.value;
  textMgr.updateSelected({ rotation: +boxRotation.value });
});
alignBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    alignBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    textMgr.updateSelected({ align: btn.dataset.align });
  });
});
btnDeleteBox?.addEventListener('click', () => {
  if (textMgr.selectedId) { textMgr.remove(textMgr.selectedId); toast('Caixa removida.', 'info'); }
});

// ═══════════════════════════════════════════════════════════════
// ZOOM
// ═══════════════════════════════════════════════════════════════
zoomRange?.addEventListener('input', () => {
  const s = +zoomRange.value / 100;
  editor.setScale(s);
  syncZoomUI(editor.scale);
});
btnFit?.addEventListener('click', () => {
  if (!state.image) return;
  const s = editor.fitToStage(state.image.naturalWidth, state.image.naturalHeight);
  syncZoomUI(s);
});
btnZoomReset?.addEventListener('click', () => {
  editor.setScale(1);
  if (state.image) editor.centerInStage(state.image.naturalWidth, state.image.naturalHeight);
  syncZoomUI(1);
});

function syncZoomUI(s) {
  if (zoomRange) zoomRange.value = Math.round(s * 100);
  if (zoomVal)   zoomVal.textContent = Math.round(s * 100);
}

// ═══════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════
btnExport?.addEventListener('click', () => {
  showLoading('Exportando…', 70);
  try {
    const url = editor.exportImage(textMgr.getAllData());
    const a   = Object.assign(document.createElement('a'), {
      download: `manga-${Date.now()}.png`, href: url,
    });
    a.click();
    setStep(5);
    hideLoading();
    toast('Imagem exportada!', 'success');
  } catch (e) {
    hideLoading();
    toast('Erro ao exportar: ' + e.message, 'error');
  }
});

// ═══════════════════════════════════════════════════════════════
// NEW IMAGE
// ═══════════════════════════════════════════════════════════════
btnNew?.addEventListener('click', () => {
  if (!confirm('Iniciar com nova imagem? O progresso será perdido.')) return;

  state.image  = null;
  state.blocks = [];

  editor.clearOverlay();
  textMgr.clear();

  stage.style.display = 'none';
  dropZone.style.display = '';

  btnRunOCR.disabled  = true;
  btnTranslate.disabled = true;
  btnAddText.disabled = true;
  fileInput.value     = '';

  clearStatus('ocr-status');
  clearStatus('trans-status');
  renderBlockList();
  setStep(1);
  if (boxEditor) boxEditor.style.display = 'none';
});

// ═══════════════════════════════════════════════════════════════
// KEYBOARD SHORTCUTS
// ═══════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const map = {
    'b': 'brush', 'e': 'eraser', 'u': 'blur',
    'f': 'fill',  'c': 'clone',  's': 'selection',
  };

  if (map[e.key]) {
    const btn = document.querySelector(`.tool-btn[data-tool="${map[e.key]}"]`);
    if (btn) btn.click();
    return;
  }

  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); btnUndo?.click(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); btnRedo?.click(); }
  if (e.key === '0') btnFit?.click();
  if (e.key === '1') btnZoomReset?.click();
  if ((e.key === '+' || e.key === '=') && !e.ctrlKey) {
    editor.setScale(editor.scale * 1.15); syncZoomUI(editor.scale);
  }
  if (e.key === '-' && !e.ctrlKey) {
    editor.setScale(editor.scale / 1.15); syncZoomUI(editor.scale);
  }
  if (e.key === 'Escape') {
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null);
    editor.clearSelection();
    textMgr.deselect();
    renderToolOptions(null);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && textMgr.selectedId) {
    textMgr.remove(textMgr.selectedId);
    toast('Caixa removida.', 'info');
  }
});

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
if (boxEditor) boxEditor.style.display = 'none';
renderBlockList();
setStep(1);
toast('MangaEasyTranslator v3 pronto! Faça upload de uma página.', 'info', 4000);
