/**
 * app.js — MET10
 * Application orchestrator. Wires together all layers.
 * All business logic lives here or in core/. UI layer only calls dispatch().
 */

import { ocrFullPage, ocrRegion, ocrLasso, ocrStroke } from './core/ocr.js';
import { inpaintRect, inpaintLasso, inpaintTextOnly } from './core/inpaint.js';
import { translateBatch } from './core/translate.js';
import { Store } from './state/store.js';
import {
  buildProjectData, saveProjectFile, loadProjectFile,
  restoreProjectData, startAutosave, loadAutosave, exportPNG,
} from './state/project.js';
import { t } from './state/i18n.js';
import { CanvasRenderer } from './renderer/canvas.js';
import { TextRenderer } from './renderer/text.js';
import { BlockPanel } from './ui/blockPanel.js';
import { BoxEditor } from './ui/boxEditor.js';
import { toast, showLoading, updateLoading, hideLoading, $ } from './ui/components.js';

// ── DOM refs ──────────────────────────────────────────────────────────────
const dropZone       = $('drop-zone');
const fileInput      = $('file-input');
const projInput      = $('project-file-input');
const stage          = $('canvas-stage');
const canvasWorld    = $('canvas-world');
const baseCanvas     = $('base-canvas');
const inpaintCanvas  = $('inpaint-canvas');
const selCanvas      = $('selection-canvas');
const overlayCanvas  = $('overlay-canvas');
const previewCanvas  = $('preview-canvas');
const blockListEl    = $('block-list');
const boxEditorPanel = $('box-editor');
const btnNew         = $('btn-new');
const btnSave        = $('btn-save');
const btnLoad        = $('btn-load');
const btnExport      = $('btn-export');
const btnOcrAll      = $('btn-ocr-all');
const btnTransAll    = $('btn-trans-all');
const btnUndo        = $('btn-undo');
const btnRedo        = $('btn-redo');
const btnFit         = $('btn-fit');
const btnLang        = $('btn-lang');
const zoomRange      = $('zoom-range');
const zoomVal        = $('zoom-val');
const ocrLangSel     = $('ocr-lang');
const ocrPsmSel      = $('ocr-psm');
const transLangSel   = $('trans-lang');
const selToolbar     = $('sel-toolbar');
const btnSelOcr      = $('btn-sel-ocr');
const btnSelClean    = $('btn-sel-clean');
const btnSelInpaint  = $('btn-sel-inpaint');
const btnSelText     = $('btn-sel-text');
const btnSelClear    = $('btn-sel-clear');

// ── Core modules ──────────────────────────────────────────────────────────
const store    = new Store();
const renderer = new CanvasRenderer({ stage, base: baseCanvas, inpaint: inpaintCanvas, selection: selCanvas, overlay: overlayCanvas });
const textRend = new TextRenderer(canvasWorld, previewCanvas);

const blockPanel = new BlockPanel(blockListEl, {
  onSelect:  id => dispatch({ type: 'SELECT_BLOCK',  payload: { id } }),
  onRemove:  id => _removeBlock(id),
  onOcr:     id => _ocrBlock(id),
  onClean:   id => _cleanBlock(id),
  onInpaint: id => _inpaintBlock(id),
  onApply:   id => _applyBlock(id),
});

const boxEditor = new BoxEditor(boxEditorPanel, (id, patch) => {
  dispatch({ type: 'UPDATE_BLOCK', payload: { id, ...patch } });
});

let _inpaintThreshold = 85;
document.addEventListener('met:threshold', e => { _inpaintThreshold = e.detail; });

// ── Dispatch ──────────────────────────────────────────────────────────────
function dispatch(action) { store.dispatch(action); }

// ── State subscription ────────────────────────────────────────────────────
store.subscribe((state, action) => _syncUI(state, action));

function _syncUI(state, action) {
  const lang = state.i18n;
  blockPanel.setLang(lang);
  boxEditor.setLang(lang);

  const blockMutations = new Set([
    'ADD_BLOCK','ADD_BLOCKS','REMOVE_BLOCK','REMOVE_ALL_BLOCKS',
    'UPDATE_BLOCK','MARK_APPLIED','SET_TRANSLATION','SET_ALL_TRANSLATIONS',
    'UNDO','REDO','SELECT_BLOCK','DESELECT_BLOCK','LOAD_IMAGE','RESET',
  ]);

  if (blockMutations.has(action.type)) {
    blockPanel.render(state.blocks, state.activeBlockId);
    const ids = new Set(state.blocks.map(b => b.id));
    for (const id of [...textRend._boxes.keys()]) if (!ids.has(id)) textRend.remove(id);
    for (const block of state.blocks) textRend.update(block);
  }

  if (action.type === 'SELECT_BLOCK') {
    const block = state.blocks.find(b => b.id === state.activeBlockId);
    if (block) { boxEditor.show(block); textRend.select(block.id); }
    _activateTab('blocks');
  }
  if (action.type === 'DESELECT_BLOCK') { boxEditor.hide(); textRend.deselect(); }

  if (action.type === 'LOAD_IMAGE' || action.type === 'RESET') {
    textRend.clear(); boxEditor.hide();
    blockPanel.render([], null);
    dropZone?.classList.toggle('hidden', !!state.image);
    _setImageActions(!!state.image);
  }

  if (action.type === 'ADD_BLOCK' || action.type === 'ADD_BLOCKS') _setImageActions(true);

  if (btnUndo) btnUndo.disabled = !store.canUndoBlock() && !store.canUndoCanvas();
  if (btnRedo) btnRedo.disabled = !store.canRedoBlock() && !store.canRedoCanvas();
  if (zoomVal)   zoomVal.textContent   = Math.round(state.zoom * 100) + '%';
  if (zoomRange) zoomRange.value       = Math.round(state.zoom * 100);
  if (btnLang)   btnLang.textContent   = lang === 'pt' ? '🌐 EN' : '🌐 PT';
}

function _setImageActions(hasImage) {
  [btnExport, btnOcrAll, btnTransAll, $('btn-ocr-all-2'), $('btn-trans-all-2')].forEach(b => {
    if (b) b.disabled = !hasImage;
  });
}

// ── Image load ────────────────────────────────────────────────────────────
async function _loadImageFile(file) {
  showLoading('Carregando…', 20);
  try {
    const url = URL.createObjectURL(file);
    const img = await _loadImg(url);
    URL.revokeObjectURL(url);
    renderer.loadImage(img);
    previewCanvas.width  = baseCanvas.width;
    previewCanvas.height = baseCanvas.height;
    dispatch({ type: 'LOAD_IMAGE', payload: { image: img, name: file.name.replace(/\.[^.]+$/, '') } });
    toast(t(store.getState().i18n, 'toastLoaded'));
    _startAutosave();
  } catch (e) {
    toast(t(store.getState().i18n, 'toastError', e.message), 'error');
  } finally { hideLoading(); }
}

// ── OCR ───────────────────────────────────────────────────────────────────
async function _runFullOCR() {
  const state = store.getState();
  if (!state.image) return;
  const lang = ocrLangSel?.value || state.ocrLang;
  const psm  = ocrPsmSel?.value  || '11';
  showLoading(t(state.i18n, 'statusOcr'), 0);
  try {
    const blocks = await ocrFullPage(baseCanvas, { lang, psm, onProgress: updateLoading });
    if (!blocks.length) { toast(t(state.i18n, 'toastNoText'), 'warn'); return; }
    dispatch({ type: 'ADD_BLOCKS', payload: blocks });
    toast(t(state.i18n, 'toastOcrDone', blocks.length));
    _activateTab('blocks');
  } catch (e) {
    toast(t(state.i18n, 'toastError', e.message), 'error');
  } finally { hideLoading(); }
}

async function _ocrSelection(sel) {
  const state = store.getState();
  const lang  = ocrLangSel?.value || state.ocrLang;
  showLoading(t(state.i18n, 'statusOcr'), 0);
  try {
    let result = null;
    if (sel.type === 'stroke') {
      const [p1, p2] = sel.points;
      const r = await ocrStroke(baseCanvas, p1, p2, 40, { lang, onProgress: updateLoading });
      result = r?.block ?? null;
    } else if (sel.type === 'lasso' && sel.points?.length > 2) {
      result = await ocrLasso(baseCanvas, sel.points, { lang, onProgress: updateLoading });
      if (result) result.bbox = sel.rect;
    } else {
      result = await ocrRegion(baseCanvas, sel.rect, { lang, onProgress: updateLoading });
    }
    if (!result) { toast(t(state.i18n, 'toastNoText'), 'warn'); return; }
    dispatch({ type: 'ADD_BLOCK', payload: result });
    toast(t(state.i18n, 'toastOcrDone', 1));
    renderer.clearSelection();
    _activateTab('blocks');
  } catch (e) {
    toast(t(state.i18n, 'toastError', e.message), 'error');
  } finally { hideLoading(); }
}

async function _ocrBlock(id) {
  const state = store.getState();
  const block = state.blocks.find(b => b.id === id);
  if (!block) return;
  showLoading(t(state.i18n, 'statusOcr'), 0);
  try {
    const result = await ocrRegion(baseCanvas, block.bbox, { lang: ocrLangSel?.value || state.ocrLang, onProgress: updateLoading });
    if (result) dispatch({ type: 'UPDATE_BLOCK', payload: { id, text: result.text, confidence: result.confidence } });
  } catch (e) {
    toast(t(state.i18n, 'toastError', e.message), 'error');
  } finally { hideLoading(); }
}

// ── Translation ───────────────────────────────────────────────────────────
async function _translateAll() {
  const state  = store.getState();
  const toLang = transLangSel?.value || state.transLang;
  const pending = state.blocks.filter(b => b.text && !b.translation);
  if (!pending.length) { toast('Nada para traduzir', 'info'); return; }
  showLoading(t(state.i18n, 'statusTranslating'), 0);
  try {
    const texts      = pending.map(b => b.text);
    const translated = await translateBatch(texts, toLang, 'auto', {
      onProgress: (done, total) => updateLoading(Math.round(done / total * 100), `${done}/${total}…`),
    });
    const payload = pending.map((b, i) => ({ id: b.id, translation: translated[i] }));
    dispatch({ type: 'SET_ALL_TRANSLATIONS', payload });
    toast(t(state.i18n, 'toastTransDone'));
  } catch (e) {
    toast(t(state.i18n, 'toastError', e.message), 'error');
  } finally { hideLoading(); }
}

// ── Inpaint / Clean ───────────────────────────────────────────────────────
async function _inpaintSelection(sel) {
  store.pushCanvasSnapshot(renderer.captureSnapshot());
  showLoading(t(store.getState().i18n, 'statusInpainting'), 20);
  try {
    if (sel.type === 'lasso' && sel.points?.length > 2) inpaintLasso(baseCanvas, sel.points);
    else { const { x, y, w, h } = sel.rect; inpaintRect(baseCanvas, x, y, w, h); }
    toast(t(store.getState().i18n, 'toastInpaintDone'));
    renderer.clearSelection();
  } finally { hideLoading(); }
}

async function _cleanSelection(sel) {
  store.pushCanvasSnapshot(renderer.captureSnapshot());
  const { x, y, w, h } = sel.rect;
  inpaintTextOnly(baseCanvas, x, y, w, h, { threshold: _inpaintThreshold });
  toast(t(store.getState().i18n, 'toastInpaintDone'));
  renderer.clearSelection();
}

async function _cleanBlock(id) {
  const block = store.getState().blocks.find(b => b.id === id);
  if (!block) return;
  store.pushCanvasSnapshot(renderer.captureSnapshot());
  const { x, y, w, h } = block.bbox;
  inpaintTextOnly(baseCanvas, x, y, w, h, { threshold: _inpaintThreshold });
  toast(t(store.getState().i18n, 'toastInpaintDone'));
}

async function _inpaintBlock(id) {
  const block = store.getState().blocks.find(b => b.id === id);
  if (!block) return;
  store.pushCanvasSnapshot(renderer.captureSnapshot());
  const { x, y, w, h } = block.bbox;
  inpaintRect(baseCanvas, x, y, w, h);
  toast(t(store.getState().i18n, 'toastInpaintDone'));
}

// ── Apply / Unapply ───────────────────────────────────────────────────────
function _applyBlock(id) {
  const block = store.getState().blocks.find(b => b.id === id);
  if (!block?.translation) { toast('Sem tradução para aplicar', 'warn'); return; }
  const { x, y, w, h } = block.bbox;
  const snapshot = renderer.getRegionSnapshot(x, y, w, h);
  const ctx = baseCanvas.getContext('2d');
  textRend._renderBlockToCtx(ctx, block);
  dispatch({ type: 'MARK_APPLIED', payload: { id, snapshotData: _imageDataToBase64(snapshot) } });
}

function _unapplyBlock(id) {
  const block = store.getState().blocks.find(b => b.id === id);
  if (!block?.applied || !block.snapshotData) return;
  const { x, y, w, h } = block.bbox;
  const img = new Image();
  img.onload = () => baseCanvas.getContext('2d').drawImage(img, 0, 0, w, h, x, y, w, h);
  img.src = block.snapshotData;
  dispatch({ type: 'UPDATE_BLOCK', payload: { id, applied: false, snapshotData: null } });
}

// ── Remove ────────────────────────────────────────────────────────────────
function _removeBlock(id) {
  const block = store.getState().blocks.find(b => b.id === id);
  if (!block) return;
  if (block.applied) _unapplyBlock(id);
  textRend.remove(id);
  dispatch({ type: 'REMOVE_BLOCK', payload: { id } });
}

function _addTextAtSelection(sel) {
  const { x, y, w, h } = sel.rect;
  dispatch({ type: 'ADD_BLOCK', payload: {
    id: `block-manual-${Date.now()}`, text: '', translation: 'Texto',
    bbox: { x, y, w, h }, fontSize: 18, fontFamily: 'Bangers', visible: true, applied: false,
  }});
  renderer.clearSelection();
  _activateTab('blocks');
}

// ── Undo / Redo ───────────────────────────────────────────────────────────
function _undo() {
  if (store.canUndoCanvas()) { const s = store.popCanvasUndo(); if (s) renderer.restoreSnapshot(s); }
  store.undoBlock();
}
function _redo() {
  if (store.canRedoCanvas()) { const s = store.popCanvasRedo(); if (s) renderer.restoreSnapshot(s); }
  store.redoBlock();
}

// ── Project ───────────────────────────────────────────────────────────────
function _saveProject() {
  const state = store.getState();
  if (!state.image) { toast('Nenhuma imagem carregada', 'warn'); return; }
  saveProjectFile(buildProjectData(state, baseCanvas));
  dispatch({ type: 'MARK_SAVED' });
  toast(t(state.i18n, 'toastSaved'));
}

async function _loadProject(file) {
  showLoading('Carregando projeto…', 20);
  try {
    const data = await loadProjectFile(file);
    const { img, blocks, ocrLang, transLang, name } = await restoreProjectData(data);
    renderer.loadImage(img);
    previewCanvas.width = baseCanvas.width; previewCanvas.height = baseCanvas.height;
    dispatch({ type: 'LOAD_IMAGE', payload: { image: img, name } });
    if (blocks.length) dispatch({ type: 'ADD_BLOCKS', payload: blocks });
    if (ocrLangSel) ocrLangSel.value = ocrLang;
    if (transLangSel) transLangSel.value = transLang;
    toast(t(store.getState().i18n, 'toastProjectLoaded'));
    _startAutosave();
  } catch (e) {
    toast(t(store.getState().i18n, 'toastError', e.message), 'error');
  } finally { hideLoading(); }
}

function _export() {
  const state = store.getState();
  if (!state.image) return;
  exportPNG(baseCanvas, previewCanvas, state.project.name || 'export');
  toast(t(state.i18n, 'toastExported'));
}

function _startAutosave() {
  startAutosave(() => {
    const state = store.getState();
    if (!state.image) return null;
    try { return buildProjectData(state, baseCanvas); } catch (_) { return null; }
  });
}

// ── Selection toolbar ─────────────────────────────────────────────────────
let _currentSel = null;

renderer.onSelectionChange = (sel, tool) => {
  _currentSel = sel ? { ...sel, type: tool } : null;
  if (!selToolbar) return;
  if (!sel) { selToolbar.classList.add('hidden'); return; }
  selToolbar.classList.remove('hidden');
  const stageR = stage.getBoundingClientRect();
  const sx = stageR.left + renderer.tx + (sel.rect.x + sel.rect.w / 2) * renderer.scale;
  const sy = stageR.top  + renderer.ty + (sel.rect.y + sel.rect.h)     * renderer.scale + 10;
  selToolbar.style.left = Math.min(window.innerWidth  - 280, Math.max(4, sx - 120)) + 'px';
  selToolbar.style.top  = Math.min(window.innerHeight - 50,  Math.max(60, sy))       + 'px';
};

renderer.onZoomChange   = s  => dispatch({ type: 'SET_ZOOM',    payload: { zoom: s } });
renderer.onCanvasChange = () => dispatch({ type: 'MARK_MODIFIED' });
textRend.onSelect   = id => dispatch({ type: 'SELECT_BLOCK',  payload: { id } });
textRend.onDeselect = ()  => dispatch({ type: 'DESELECT_BLOCK' });
textRend.onChange   = (id, patch) => dispatch({ type: 'UPDATE_BLOCK', payload: { id, ...patch } });

// ── Event wiring ──────────────────────────────────────────────────────────
dropZone?.addEventListener('click',     () => fileInput?.click());
dropZone?.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone?.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (f?.type.startsWith('image/')) _loadImageFile(f);
});
fileInput?.addEventListener('change', e => { const f = e.target.files[0]; if (f) _loadImageFile(f); e.target.value=''; });

btnNew?.addEventListener('click', () => {
  if (!window.confirm(t(store.getState().i18n, 'confirmNew'))) return;
  dispatch({ type: 'RESET' });
  textRend.clear(); boxEditor.hide(); renderer.clearSelection();
  baseCanvas.getContext('2d').clearRect(0,0,baseCanvas.width,baseCanvas.height);
  previewCanvas.getContext('2d').clearRect(0,0,previewCanvas.width,previewCanvas.height);
});
btnSave?.addEventListener('click', _saveProject);
btnLoad?.addEventListener('click', () => projInput?.click());
projInput?.addEventListener('change', e => { const f = e.target.files[0]; if (f) _loadProject(f); e.target.value=''; });
btnExport?.addEventListener('click', _export);
btnOcrAll?.addEventListener('click', _runFullOCR);
btnTransAll?.addEventListener('click', _translateAll);
btnFit?.addEventListener('click', () => renderer.fitToStage());
btnLang?.addEventListener('click', () => {
  const cur = store.getState().i18n;
  dispatch({ type: 'SET_I18N', payload: { lang: cur === 'pt' ? 'en' : 'pt' } });
  _applyI18n();
});
btnUndo?.addEventListener('click', _undo);
btnRedo?.addEventListener('click', _redo);

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if ((e.ctrlKey||e.metaKey) && e.key==='z') { e.preventDefault(); _undo(); }
  if ((e.ctrlKey||e.metaKey) && (e.key==='y'||(e.shiftKey&&e.key==='z'))) { e.preventDefault(); _redo(); }
  if ((e.ctrlKey||e.metaKey) && e.key==='s') { e.preventDefault(); _saveProject(); }
  if ((e.key==='Delete'||e.key==='Backspace') && store.getState().activeBlockId) {
    e.preventDefault(); _removeBlock(store.getState().activeBlockId);
  }
});

document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderer.setTool(btn.dataset.tool);
    dispatch({ type: 'SET_TOOL', payload: { tool: btn.dataset.tool } });
  });
});

document.addEventListener('met:tool',      e => { const tool=e.detail; document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool)); renderer.setTool(tool); dispatch({type:'SET_TOOL',payload:{tool}}); });
document.addEventListener('met:toolsize',  e => { renderer.toolSize  = e.detail; });
document.addEventListener('met:toolcolor', e => { renderer.toolColor = e.detail; });
document.addEventListener('met:clearall',  () => {
  if (!store.getState().blocks.length) return;
  if (!window.confirm(t(store.getState().i18n,'confirmDeleteAll'))) return;
  store.getState().blocks.filter(b=>b.applied).forEach(b=>_unapplyBlock(b.id));
  textRend.clear();
  dispatch({ type: 'REMOVE_ALL_BLOCKS' });
});

btnSelOcr?.addEventListener('click',     () => { if (_currentSel) _ocrSelection(_currentSel); });
btnSelClean?.addEventListener('click',   () => { if (_currentSel) _cleanSelection(_currentSel); });
btnSelInpaint?.addEventListener('click', () => { if (_currentSel) _inpaintSelection(_currentSel); });
btnSelText?.addEventListener('click',    () => { if (_currentSel) _addTextAtSelection(_currentSel); });
btnSelClear?.addEventListener('click',   () => renderer.clearSelection());

zoomRange?.addEventListener('input', e => renderer.setScale(parseInt(e.target.value)/100));
ocrLangSel?.addEventListener('change',   e => dispatch({ type: 'SET_OCR_LANG',   payload: { lang: e.target.value } }));
transLangSel?.addEventListener('change', e => dispatch({ type: 'SET_TRANS_LANG', payload: { lang: e.target.value } }));

// ── Helpers ───────────────────────────────────────────────────────────────
function _activateTab(name) {
  document.querySelectorAll('.panel-tab').forEach(t => t.classList.toggle('active', t.dataset.tab===name));
  document.querySelectorAll('.panel-content').forEach(c => c.classList.toggle('active', c.id===`tab-${name}`));
}

function _applyI18n() {
  const lang = store.getState().i18n;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const str = t(lang, key);
    if (str && typeof str==='string') el.textContent = str;
  });
}

function _loadImg(src) {
  return new Promise((res,rej) => { const img=new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=src; });
}

function _imageDataToBase64(imageData) {
  const tmp=document.createElement('canvas');
  tmp.width=imageData.width; tmp.height=imageData.height;
  tmp.getContext('2d').putImageData(imageData,0,0);
  return tmp.toDataURL('image/png');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
_applyI18n();
(async () => {
  try {
    const data = await loadAutosave();
    if (data?.imageData && window.confirm(t(store.getState().i18n,'autosaveFound'))) {
      const blob = new Blob([JSON.stringify(data)],{type:'application/json'});
      await _loadProject(new File([blob],'autosave.met10'));
    }
  } catch(_) {}
})();
