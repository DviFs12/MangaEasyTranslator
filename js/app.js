/**
 * app.js — v4
 *
 * Novidades vs v3:
 *  • Worker Tesseract reutilizado entre chamadas (getWorker singleton)
 *  • OCR manual de região: usuário faz seleção → roda OCR só nela
 *  • Re-OCR por bloco individual (botão 🔄 no painel)
 *  • Smart placement: ao aplicar tradução, verifica densidade de pixels
 *    e emite aviso se a caixa cobre arte importante
 *  • TextManager recebe referência ao editor para conversão de escala correta
 */

import { runOCR, runOCRRegion, terminateWorker } from './ocr.js';
import { translateBatch }    from './translate.js';
import { CanvasEditor }      from './editor.js';
import { TextManager }       from './textManager.js';
import { pickFont, pickFontSize, FONTS } from './fontManager.js';
import {
  toast, showLoading, updateLoading, hideLoading,
  setStep, setStatus, clearStatus,
  renderBlocks, updateBlockCard, highlightBlock,
} from './ui.js';

const $ = (id) => document.getElementById(id);

// ── DOM ────────────────────────────────────────────────────
const dropZone   = $('drop-zone');
const fileInput  = $('file-input');
const stage      = $('canvas-stage');
const world      = $('canvas-world');
const baseCanvas = $('base-canvas');
const selCanvas  = $('selection-canvas');
const ovrCanvas  = $('overlay-canvas');
const prvCanvas  = $('preview-canvas');
const textLayer  = $('text-layer');

const btnRunOCR    = $('btn-run-ocr');
const btnTranslate = $('btn-translate-all');
const btnExport    = $('btn-export');
const btnNew       = $('btn-new');
const btnAddText   = $('btn-add-text');
const btnUndo      = $('btn-undo');
const btnRedo      = $('btn-redo');
const btnClearSel  = $('btn-clear-sel');
const btnFit       = $('btn-fit');
const btnZoomReset = $('btn-zoom-reset');
const btnDeleteBox = $('btn-delete-box');
const btnSelectFile= $('btn-select-file');

const toolBtns  = document.querySelectorAll('.tool-btn[data-tool]');
const ocrLang   = $('ocr-lang');
const transLang = $('trans-lang');
const zoomRange = $('zoom-range');
const zoomVal   = $('zoom-val');
const newTextIn = $('new-text-input');

const boxEditor   = $('box-editor');
const boxText     = $('box-text');
const boxFontFam  = $('box-font-family');
const boxFontSize = $('box-font-size');
const boxColor    = $('box-color');
const boxBg       = $('box-bg');
const boxOpacity  = $('box-opacity');
const boxOpacityV = $('box-opacity-val');
const boxRotation = $('box-rotation');
const boxRotationV= $('box-rotation-val');
const alignBtns   = document.querySelectorAll('.align-btn');

// Populate font selector
if (boxFontFam)
  boxFontFam.innerHTML = FONTS.map(f => `<option value="${f.name}">${f.label}</option>`).join('');

// ── STATE ─────────────────────────────────────────────────
const state = { image: null, blocks: [], selectedBlock: null };

// ── MODULES ───────────────────────────────────────────────
const editor = new CanvasEditor({ stage, world, base: baseCanvas,
                                   selection: selCanvas, overlay: ovrCanvas });

// Pass editor reference so TextManager can convert drag delta by scale
const textMgr = new TextManager(textLayer, prvCanvas, editor);

editor.onZoomChange = syncZoomUI;

editor.onSelectionChange = (rect) => {
  if (btnClearSel) btnClearSel.classList.toggle('hidden', !rect);
  // If selection tool active and selection finished, offer manual OCR
  if (rect && editor.activeTool === 'selection') {
    _promptManualOCR(rect);
  }
};

textMgr.onSelect = (id, data) => {
  state.selectedBlock = id;
  highlightBlock(id);
  if (boxEditor) boxEditor.style.display = '';
  _populateBoxEditor(data);
};
textMgr.onDeselect = () => {
  if (boxEditor) boxEditor.style.display = 'none';
  state.selectedBlock = null;
};

// ── UPLOAD ────────────────────────────────────────────────
btnSelectFile?.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (e) => { if (e.target.closest('.drop-content')) fileInput.click(); });
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.type.startsWith('image/')) _loadFile(f);
  else toast('Use JPG, PNG ou WebP.', 'error');
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) _loadFile(fileInput.files[0]); });

function _loadFile(file) {
  const reader = new FileReader();
  reader.onload = (ev) => {
    const img = new Image();
    img.onload = async () => {
      state.image = img; state.blocks = [];

      // Terminate cached worker — new image may need different settings
      await terminateWorker();

      editor.loadImage(img);
      [selCanvas, ovrCanvas, prvCanvas].forEach(c => { c.width = img.naturalWidth; c.height = img.naturalHeight; });
      textMgr.syncPreviewSize(img.naturalWidth, img.naturalHeight);

      stage.style.display   = '';
      dropZone.style.display = 'none';

      const s = editor.fitToStage(img.naturalWidth, img.naturalHeight);
      syncZoomUI(s);

      btnRunOCR.disabled  = false;
      btnAddText.disabled = false;
      btnExport.disabled  = false;
      setStep(2);
      toast('Imagem carregada!', 'success');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

// ── OCR COMPLETO ──────────────────────────────────────────
btnRunOCR.addEventListener('click', async () => {
  if (!state.image) return;
  btnRunOCR.disabled = true;
  showLoading('Iniciando OCR…', 0, '1ª vez: aguarde o download dos dados de idioma');
  setStep(2);

  try {
    const blocks = await runOCR(baseCanvas, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct));

    state.blocks = blocks;
    hideLoading();
    setStep(3);

    if (!blocks.length) {
      setStatus('ocr-status', 'Nenhum texto encontrado.', 'warning');
      toast('Sem texto detectado.', 'warning');
    } else {
      setStatus('ocr-status', `✓ ${blocks.length} blocos detectados.`, 'success');
      toast(`${blocks.length} blocos!`, 'success');
      btnTranslate.disabled = false;
    }
    editor.drawOverlay(blocks);
    _renderBlockList();

  } catch (err) {
    hideLoading();
    setStatus('ocr-status', `Erro: ${err.message}`, 'error');
    toast('Erro OCR: ' + err.message, 'error');
    console.error('[OCR]', err);
  } finally {
    btnRunOCR.disabled = false;
  }
});

// ── MANUAL OCR (seleção retangular) ──────────────────────

/** Called when selection finishes and selection tool is active */
async function _promptManualOCR(rect) {
  if (rect.w < 10 || rect.h < 10) return;

  showLoading('OCR da seleção…', 10);
  try {
    const block = await runOCRRegion(baseCanvas, rect, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct));

    if (!block) { hideLoading(); toast('Nenhum texto na seleção.', 'warning'); return; }

    // Avoid duplicate
    state.blocks = state.blocks.filter(b => b.id !== block.id);
    state.blocks.push(block);

    hideLoading();
    editor.drawOverlay(state.blocks, block.id);
    _renderBlockList();
    toast(`OCR manual: "${block.text.slice(0, 30)}…"`, 'success');

    // Switch back to no tool after manual OCR
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null);
    editor.clearSelection();
    btnClearSel?.classList.add('hidden');

  } catch (err) {
    hideLoading();
    toast('Erro OCR região: ' + err.message, 'error');
  }
}

// ── RE-OCR DE UM BLOCO ────────────────────────────────────
async function _reOCRBlock(id) {
  const block = state.blocks.find(b => b.id === id);
  if (!block) return;

  showLoading('Re-OCR do bloco…', 10);
  try {
    const newBlock = await runOCRRegion(baseCanvas, block.bbox, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct));

    if (!newBlock) { hideLoading(); toast('Nenhum texto detectado.', 'warning'); return; }

    // Update existing block in-place
    block.text = newBlock.text;
    block.confidence = newBlock.confidence;
    block.translation = '';  // reset translation since text changed

    hideLoading();
    editor.drawOverlay(state.blocks, id);
    _renderBlockList();
    toast(`Re-OCR: "${newBlock.text.slice(0, 30)}"`, 'success');

  } catch (err) {
    hideLoading();
    toast('Erro re-OCR: ' + err.message, 'error');
  }
}

// ── TRADUÇÃO ──────────────────────────────────────────────
btnTranslate.addEventListener('click', async () => {
  if (!state.blocks.length) return;
  btnTranslate.disabled = true;
  setStep(3);
  showLoading('Traduzindo…', 0, `${state.blocks.length} blocos`);

  state.blocks.forEach(b => { b.translating = true; });
  _renderBlockList();

  let done = 0;
  await translateBatch(
    state.blocks.map(b => ({ id: b.id, text: b.text })),
    ocrLang.value, transLang.value,
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
  toast(`${ok} blocos traduzidos.`, 'success');
  btnTranslate.disabled = false;
  _renderBlockList();
});

// ── BLOCK LIST ────────────────────────────────────────────
function _renderBlockList() {
  renderBlocks(state.blocks, {
    onSelect:          _selectBlock,
    onToggleVis:       (id) => { const b = state.blocks.find(x => x.id === id); if (b) { b.visible = !b.visible; editor.drawOverlay(state.blocks, state.selectedBlock); _renderBlockList(); } },
    onErase:           _eraseBlock,
    onReOCR:           _reOCRBlock,
    onDelete:          _deleteBlock,
    onApply:           _applyTranslation,
    onTranslationEdit: (id, text) => { const b = state.blocks.find(x => x.id === id); if (b) b.translation = text; },
  });
}

function _selectBlock(id) {
  state.selectedBlock = id;
  highlightBlock(id);
  editor.drawOverlay(state.blocks, id);
  const b = state.blocks.find(x => x.id === id);
  if (b) editor.panToCenter(b.bbox.x + b.bbox.w / 2, b.bbox.y + b.bbox.h / 2);
}

function _eraseBlock(id) {
  const b = state.blocks.find(x => x.id === id);
  if (!b) return;
  editor.fillRect(b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h, boxBg?.value || '#ffffff');
  toast('Área apagada.', 'info');
}

function _deleteBlock(id) {
  state.blocks = state.blocks.filter(b => b.id !== id);
  textMgr.remove(id);
  editor.drawOverlay(state.blocks, state.selectedBlock);
  _renderBlockList();
}

function _applyTranslation(id, text) {
  const b = state.blocks.find(x => x.id === id);
  if (!b || !text) { toast('Texto vazio.', 'warning'); return; }

  const font  = pickFont(b);
  const fSize = pickFontSize(text, b.bbox, font);
  const bg    = boxBg?.value    || '#ffffff';
  const bgOp  = (boxOpacity?.value ?? 90) / 100;
  const col   = boxColor?.value || '#000000';

  // ── Smart placement check ────────────────────────
  const analysis = textMgr.analyzeRegion(baseCanvas, b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h);
  b.placementWarning = analysis.score > 0.4;

  // Erase original
  editor.fillRect(b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h, bg);

  // Place translated box
  let tx = b.bbox.x + 2, ty = b.bbox.y + 2;
  if (analysis.suggestion) { tx = analysis.suggestion.x; ty = analysis.suggestion.y; }

  textMgr.add({
    id, text,
    x: tx, y: ty,
    w: Math.max(b.bbox.w - 4, 60),
    h: b.bbox.h,
    fontSize:   fSize,
    fontFamily: font,
    color:      col,
    bgColor:    bg,
    bgOpacity:  bgOp,
    align:      'center',
  });

  b.applied = true;
  editor.drawOverlay(state.blocks, state.selectedBlock);
  _renderBlockList();

  const msg = b.placementWarning
    ? `Aplicado — ⚠ pode cobrir arte (score ${Math.round(analysis.score * 100)}%)`
    : `Aplicado (${font}, ${fSize}px)`;
  toast(msg, b.placementWarning ? 'warning' : 'success');
}

// ── TOOLS ─────────────────────────────────────────────────
toolBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tool     = btn.dataset.tool;
    const wasActive = btn.classList.contains('active');
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null);

    if (!wasActive) {
      btn.classList.add('active');
      editor.setTool(tool);
      _renderToolOpts(tool);
      toast(`Ferramenta: ${btn.textContent.trim()}`, 'info', 1600);
    } else {
      _renderToolOpts(null);
    }
  });
});

function _renderToolOpts(tool) {
  const opts = $('tool-options');
  if (!opts) return;
  opts.innerHTML = '';
  if (!tool || tool === 'selection') {
    if (tool === 'selection') {
      const hint = document.createElement('p');
      hint.className = 'tip-text';
      hint.textContent = '🔄 Após selecionar, OCR é rodado automaticamente na região.';
      opts.appendChild(hint);
    }
    return;
  }

  const row = document.createElement('div');
  row.className = 'tool-group';
  row.innerHTML = `<label class="tool-label">Tamanho: <span id="t-size-val">20</span>px</label>
                   <input type="range" id="t-size" min="3" max="120" value="20" class="tool-range"/>`;
  opts.appendChild(row);

  if (tool === 'brush' || tool === 'fill') {
    const cr = document.createElement('div');
    cr.className = 'tool-group';
    cr.innerHTML = `<label class="tool-label">Cor</label><input type="color" id="t-color" value="#ffffff" class="tool-color"/>`;
    opts.appendChild(cr);
    opts.querySelector('#t-color')?.addEventListener('input', (e) => editor.setToolColor(e.target.value));
  }
  if (tool === 'clone') {
    const h = document.createElement('p');
    h.className = 'tip-text'; h.textContent = 'Ctrl+click = define origem. Click = aplica.';
    opts.appendChild(h);
    editor.toast = toast;
  }

  const sInp = opts.querySelector('#t-size');
  const sVal = opts.querySelector('#t-size-val');
  sInp?.addEventListener('input', () => {
    editor.setToolSize(+sInp.value);
    if (sVal) sVal.textContent = sInp.value;
  });
}

btnClearSel?.addEventListener('click', () => {
  editor.clearSelection();
  btnClearSel.classList.add('hidden');
});

// ── UNDO / REDO ────────────────────────────────────────────
btnUndo?.addEventListener('click', () => { if (!editor.undo()) toast('Nada para desfazer.', 'warning'); });
btnRedo?.addEventListener('click', () => { if (!editor.redo()) toast('Nada para refazer.',  'warning'); });

// ── TEXTO MANUAL ───────────────────────────────────────────
btnAddText?.addEventListener('click', () => {
  const text = newTextIn?.value.trim();
  if (!text) { toast('Digite o texto.', 'warning'); return; }
  textMgr.add({
    text,
    x: Math.floor(baseCanvas.width  * 0.05),
    y: Math.floor(baseCanvas.height * 0.05),
    w: Math.floor(baseCanvas.width  * 0.3),
    fontSize:   +boxFontSize?.value || 18,
    fontFamily: boxFontFam?.value   || 'Bangers',
    color:      boxColor?.value     || '#000000',
    bgColor:    boxBg?.value        || '#ffffff',
    bgOpacity:  (boxOpacity?.value ?? 90) / 100,
    align:      document.querySelector('.align-btn.active')?.dataset.align || 'center',
  });
  if (newTextIn) newTextIn.value = '';
  toast('Texto adicionado.', 'success');
});

// ── BOX EDITOR PANEL ──────────────────────────────────────
function _populateBoxEditor(data) {
  if (boxText)     boxText.value     = data.text;
  if (boxFontFam)  boxFontFam.value  = data.fontFamily;
  if (boxFontSize) boxFontSize.value = data.fontSize;
  if (boxColor)    boxColor.value    = data.color;
  if (boxBg)       boxBg.value       = data.bgColor;
  if (boxOpacity) { boxOpacity.value = Math.round(data.bgOpacity * 100); if (boxOpacityV) boxOpacityV.textContent = boxOpacity.value; }
  if (boxRotation){ boxRotation.value = data.rotation; if (boxRotationV) boxRotationV.textContent = data.rotation; }
  alignBtns.forEach(b => b.classList.toggle('active', b.dataset.align === data.align));
}

let _txtDebounce;
boxText?.addEventListener('input', () => {
  clearTimeout(_txtDebounce);
  _txtDebounce = setTimeout(() => textMgr.updateSelected({ text: boxText.value }), 60);
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

// ── ZOOM ──────────────────────────────────────────────────
zoomRange?.addEventListener('input', () => {
  editor.setScale(+zoomRange.value / 100); syncZoomUI(editor.scale);
});
btnFit?.addEventListener('click', () => {
  if (!state.image) return;
  syncZoomUI(editor.fitToStage(state.image.naturalWidth, state.image.naturalHeight));
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

// ── EXPORT ────────────────────────────────────────────────
btnExport?.addEventListener('click', () => {
  showLoading('Exportando…', 70);
  try {
    const url = editor.exportImage(textMgr.getAllData());
    Object.assign(document.createElement('a'),
      { download: `manga-${Date.now()}.png`, href: url }).click();
    setStep(5);
    hideLoading();
    toast('Exportado!', 'success');
  } catch (e) {
    hideLoading(); toast('Erro: ' + e.message, 'error');
  }
});

// ── NEW IMAGE ─────────────────────────────────────────────
btnNew?.addEventListener('click', async () => {
  if (!confirm('Iniciar com nova imagem? O progresso será perdido.')) return;
  await terminateWorker();
  state.image = null; state.blocks = [];
  editor.clearOverlay(); textMgr.clear();
  stage.style.display    = 'none';
  dropZone.style.display = '';
  btnRunOCR.disabled = true; btnTranslate.disabled = true;
  btnAddText.disabled = true; fileInput.value = '';
  clearStatus('ocr-status'); clearStatus('trans-status');
  _renderBlockList(); setStep(1);
  if (boxEditor) boxEditor.style.display = 'none';
});

// ── KEYBOARD ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const map = { b:'brush', e:'eraser', u:'blur', f:'fill', c:'clone', s:'selection' };
  if (map[e.key]) {
    document.querySelector(`.tool-btn[data-tool="${map[e.key]}"]`)?.click(); return;
  }
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); btnUndo?.click(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); btnRedo?.click(); }
  if (e.key === '0') btnFit?.click();
  if (e.key === '1') btnZoomReset?.click();
  if ((e.key === '+' || e.key === '=') && !e.ctrlKey) { editor.setScale(editor.scale * 1.15); syncZoomUI(editor.scale); }
  if (e.key === '-' && !e.ctrlKey)                     { editor.setScale(editor.scale / 1.15); syncZoomUI(editor.scale); }
  if (e.key === 'Escape') {
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null); editor.clearSelection(); textMgr.deselect(); _renderToolOpts(null);
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && textMgr.selectedId) {
    textMgr.remove(textMgr.selectedId); toast('Caixa removida.', 'info');
  }
});

// ── INIT ─────────────────────────────────────────────────
if (boxEditor) boxEditor.style.display = 'none';
_renderBlockList();
setStep(1);
toast('MangaEasyTranslator v4 — carregado!', 'info', 4000);
