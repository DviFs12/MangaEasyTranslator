/**
 * app.js — v5
 *
 * Novas features:
 *  1. Detecção de balões (OpenCV.js + fallback)
 *  2. Inpaint automático por bloco e por pincel
 *  3. Sistema de projeto: salvar/carregar .met
 *  4. Painel de camadas com visibilidade
 *  5. Ferramenta text-box: desenha bbox → cria TextBox imediatamente
 *  6. Botão OCR na caixa selecionada
 */

import { runOCR, runOCRRegion, terminateWorker } from './ocr.js';
import { translateBatch }      from './translate.js';
import { CanvasEditor }        from './editor.js';
import { TextManager }         from './textManager.js';
import { pickFont, pickFontSize, FONTS } from './fontManager.js';
import { detectBalloons, findBalloonForBlock, waitForOpenCV } from './balloonDetector.js';
import { inpaintRect, inpaintMask } from './inpaint.js';
import {
  buildProject, saveProjectFile, loadProjectFile,
  restoreProject, autosave, getAutosave,
} from './projectManager.js';
import {
  toast, showLoading, updateLoading, hideLoading,
  setStep, setStatus, clearStatus,
  renderBlocks, updateBlockCard, highlightBlock,
} from './ui.js';

const $ = id => document.getElementById(id);

// ── DOM ───────────────────────────────────────────────────
const dropZone    = $('drop-zone');
const fileInput   = $('file-input');
const projInput   = $('project-file-input');
const stage       = $('canvas-stage');
const world       = $('canvas-world');
const baseCanvas  = $('base-canvas');
const inpCanvas   = $('inpaint-canvas');
const selCanvas   = $('selection-canvas');
const ovrCanvas   = $('overlay-canvas');
const prvCanvas   = $('preview-canvas');
const textLayer   = $('text-layer');

const btnRunOCR      = $('btn-run-ocr');
const btnDetectBal   = $('btn-detect-balloons');
const btnTranslate   = $('btn-translate-all');
const btnExport      = $('btn-export');
const btnNew         = $('btn-new');
const btnSaveProj    = $('btn-save-project');
const btnLoadProj    = $('btn-load-project');
const btnAddText     = $('btn-add-text');
const btnUndo        = $('btn-undo');
const btnRedo        = $('btn-redo');
const btnClearSel    = $('btn-clear-sel');
const btnApplyInpSel = $('btn-apply-inpaint-sel');
const btnFit         = $('btn-fit');
const btnZoomReset   = $('btn-zoom-reset');
const btnDeleteBox   = $('btn-delete-box');
const btnOcrBox      = $('btn-ocr-box');
const btnInpaintBox  = $('btn-inpaint-box');
const btnSelectFile  = $('btn-select-file');
const linkLoadProj   = $('link-load-project');

const toolBtns    = document.querySelectorAll('.tool-btn[data-tool]');
const ocrLang     = $('ocr-lang');
const ocrPsm      = $('ocr-psm');
const transLang   = $('trans-lang');
const zoomRange   = $('zoom-range');
const zoomVal     = $('zoom-val');
const newTextIn   = $('new-text-input');
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

if (boxFontFam) boxFontFam.innerHTML = FONTS.map(f=>`<option value="${f.name}">${f.label}</option>`).join('');

// ── STATE ─────────────────────────────────────────────────
const state = {
  image:        null,
  blocks:       [],
  balloons:     [],
  selectedBlock: null,
};

// ── MODULES ───────────────────────────────────────────────
const editor = new CanvasEditor({
  stage, world,
  base:      baseCanvas,
  inpaint:   inpCanvas,
  selection: selCanvas,
  overlay:   ovrCanvas,
});

const textMgr = new TextManager(textLayer, prvCanvas, editor);
editor.onZoomChange = syncZoomUI;

editor.onSelectionChange = (rect, tool) => {
  if (btnClearSel) btnClearSel.classList.toggle('hidden', !rect);
  if (btnApplyInpSel) btnApplyInpSel.classList.toggle('hidden', !(rect && tool === 'inpaint'));

  if (!rect) return;
  if (tool === 'selection')  _promptManualOCR(rect);
  if (tool === 'text-box')   _createTextBoxFromRect(rect);
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

// ── LAYER VISIBILITY ─────────────────────────────────────
document.querySelectorAll('.layer-eye').forEach(eye => {
  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    const layer  = eye.dataset.layer;
    const item   = eye.closest('.layer-item');
    const hidden = item.classList.toggle('hidden-layer');
    eye.textContent = hidden ? '🙈' : '👁';

    if (layer === 'base' || layer === 'inpaint' || layer === 'overlay') {
      editor.setLayerVisible(layer, !hidden);
    }
    if (layer === 'text') {
      textLayer.style.opacity  = hidden ? '0' : '';
      prvCanvas.style.opacity  = hidden ? '0' : '';
    }
  });
});

// ── FILE UPLOAD ───────────────────────────────────────────
btnSelectFile?.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click',    (e) => { if (e.target.closest('.drop-content')&&!e.target.matches('a')) fileInput.click(); });
dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave',()  => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop',     (e) => {
  e.preventDefault(); dropZone.classList.remove('drag-over');
  const f = e.dataTransfer.files[0];
  if (f?.name.endsWith('.met') || f?.type === 'application/json') _doLoadProject(f);
  else if (f?.type.startsWith('image/')) _loadImageFile(f);
  else toast('Use JPG/PNG ou arquivo .met', 'error');
});
fileInput.addEventListener('change', () => { if (fileInput.files[0]) _loadImageFile(fileInput.files[0]); });

async function _loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const img = new Image();
    img.onload = async () => {
      await _initWithImage(img);
      toast('Imagem carregada!', 'success');
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function _initWithImage(img) {
  state.image = img; state.blocks = []; state.balloons = [];
  await terminateWorker();
  editor.loadImage(img);
  [selCanvas, ovrCanvas, prvCanvas].forEach(c => { c.width=img.naturalWidth; c.height=img.naturalHeight; });
  inpCanvas.width = img.naturalWidth; inpCanvas.height = img.naturalHeight;
  textMgr.syncPreviewSize(img.naturalWidth, img.naturalHeight);
  stage.style.display = ''; dropZone.style.display = 'none';
  const s = editor.fitToStage(img.naturalWidth, img.naturalHeight);
  syncZoomUI(s);
  btnRunOCR.disabled = false; btnAddText.disabled = false;
  btnExport.disabled = false; btnDetectBal.disabled = false;
  setStep(2);

  // Offer autosave restore
  const saved = getAutosave();
  if (saved?.timestamp && Date.now() - saved.timestamp < 24*3600000) {
    toast('Autosave disponível — use "Carregar" para restaurar', 'info', 5000);
  }
}

// ── PROJECT SAVE / LOAD ────────────────────────────────────
btnSaveProj?.addEventListener('click', () => {
  if (!state.image) { toast('Nenhuma imagem carregada', 'warning'); return; }
  const project = buildProject({
    baseCanvas, inpaintCanvas: inpCanvas,
    blocks: state.blocks, textBoxes: textMgr.getAllData(),
    balloons: state.balloons,
    meta: { lang: ocrLang.value, transLang: transLang.value },
  });
  autosave(project);
  saveProjectFile(project);
  toast('Projeto salvo!', 'success');
});

btnLoadProj?.addEventListener('click', () => projInput.click());
linkLoadProj?.addEventListener('click', (e) => { e.preventDefault(); projInput.click(); });
projInput?.addEventListener('change', async () => {
  if (projInput.files[0]) await _doLoadProject(projInput.files[0]);
});

async function _doLoadProject(file) {
  showLoading('Carregando projeto…', 30);
  try {
    const project = await loadProjectFile(file);
    const { image, blocks, textBoxes, balloons, meta } = await restoreProject(project, {
      baseCanvas, inpaintCanvas: inpCanvas,
    });
    await _initWithImage(image);
    state.blocks   = blocks;
    state.balloons = balloons;
    if (meta.lang)      ocrLang.value   = meta.lang;
    if (meta.transLang) transLang.value = meta.transLang;

    // Restore text boxes
    textMgr.clear();
    for (const box of textBoxes) textMgr.add(box);

    editor.drawOverlay(state.blocks, null, state.balloons);
    _renderBlockList();
    hideLoading();
    toast(`Projeto carregado — ${blocks.length} blocos, ${textBoxes.length} caixas`, 'success');
    if (blocks.length) { btnTranslate.disabled = false; setStep(4); }
  } catch (err) {
    hideLoading();
    toast('Erro ao carregar: ' + err.message, 'error');
    console.error('[project]', err);
  }
}

// ── OCR ───────────────────────────────────────────────────
btnRunOCR.addEventListener('click', async () => {
  if (!state.image) return;
  btnRunOCR.disabled = true;
  showLoading('Iniciando OCR…', 0, '1ª vez: aguarde o download dos dados de idioma');
  setStep(2);
  try {
    const psm    = ocrPsm?.value ?? '11';
    const blocks = await runOCR(baseCanvas, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct), psm);

    // Associate blocks with detected balloons
    if (state.balloons.length) {
      for (const b of blocks) {
        const balloon = findBalloonForBlock(b, state.balloons);
        if (balloon) { b.balloonId = `${balloon.x}-${balloon.y}`; b.balloonType = balloon.type; }
      }
    }

    state.blocks = blocks;
    hideLoading(); setStep(3);
    if (!blocks.length) {
      setStatus('ocr-status', 'Nenhum texto encontrado.', 'warning');
      toast('Sem texto detectado.', 'warning');
    } else {
      setStatus('ocr-status', `✓ ${blocks.length} blocos detectados.`, 'success');
      toast(`${blocks.length} blocos!`, 'success');
      btnTranslate.disabled = false;
    }
    editor.drawOverlay(blocks, null, state.balloons);
    _renderBlockList();
  } catch (err) {
    hideLoading();
    setStatus('ocr-status', `Erro: ${err.message}`, 'error');
    toast('Erro OCR: ' + err.message, 'error');
  } finally { btnRunOCR.disabled = false; }
});

// ── BALLOON DETECTION ─────────────────────────────────────
btnDetectBal?.addEventListener('click', async () => {
  if (!state.image) return;
  showLoading('Detectando balões…', 20, 'Aguardando OpenCV.js…');
  try {
    const ready = await waitForOpenCV(3000);
    updateLoading('Analisando contornos…', 50);
    const balloons = await detectBalloons(baseCanvas);
    state.balloons = balloons;
    updateLoading('Pronto', 100);
    hideLoading();

    const method = ready ? 'OpenCV' : 'heurística';
    toast(`${balloons.length} balões detectados (${method})`, 'success');
    editor.drawOverlay(state.blocks, null, balloons);

    // Re-associate OCR blocks with new balloons
    for (const b of state.blocks) {
      const balloon = findBalloonForBlock(b, balloons);
      b.balloonId   = balloon ? `${balloon.x}-${balloon.y}` : null;
      b.balloonType = balloon?.type ?? null;
    }
    _renderBlockList();
  } catch (err) {
    hideLoading();
    toast('Erro ao detectar balões: ' + err.message, 'error');
  }
});

// ── MANUAL OCR (selection rect) ────────────────────────────
async function _promptManualOCR(rect) {
  if (rect.w < 10 || rect.h < 10) return;
  showLoading('OCR da seleção…', 10);
  try {
    const psm   = '6'; // block uniform — best for isolated regions
    const block = await runOCRRegion(baseCanvas, rect, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct), psm);
    if (!block) { hideLoading(); toast('Nenhum texto na seleção.', 'warning'); return; }
    state.blocks = state.blocks.filter(b => b.id !== block.id);
    state.blocks.push(block);
    hideLoading();
    editor.drawOverlay(state.blocks, block.id, state.balloons);
    _renderBlockList();
    toast(`OCR: "${block.text.slice(0,30)}…"`, 'success');
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null); editor.clearSelection();
    btnClearSel?.classList.add('hidden');
  } catch (err) { hideLoading(); toast('Erro OCR: ' + err.message, 'error'); }
}

// ── CREATE TEXT BOX FROM DRAWN RECT ───────────────────────
function _createTextBoxFromRect(rect) {
  if (rect.w < 20 || rect.h < 20) return;
  const font  = 'Bangers';
  const fSize = Math.max(12, Math.min(36, Math.floor(rect.h * 0.4)));
  textMgr.add({
    x: rect.x, y: rect.y, w: rect.w, h: rect.h,
    text: '…', fontSize: fSize, fontFamily: font,
    color: '#000000', bgColor: '#ffffff', bgOpacity: 0.9, align: 'center',
  });
  editor.clearSelection();
  toolBtns.forEach(b => b.classList.remove('active'));
  editor.setTool(null);
  toast('Caixa criada! Edite o texto no painel esquerdo.', 'success');
}

// ── INPAINT ────────────────────────────────────────────────
// Apply inpaint to a block's bbox
async function _inpaintBlock(id) {
  const b = state.blocks.find(x => x.id === id);
  if (!b) return;
  showLoading('Inpaintando…', 30, 'Analisando textura…');
  try {
    await new Promise(r => setTimeout(r, 0)); // yield to browser
    const area = b.bbox.w * b.bbox.h;
    inpaintRect(baseCanvas, b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h, {
      method: area > 4000 ? 'patch' : 'telea',
    });
    hideLoading();
    toast('Inpaint aplicado!', 'success');
    // Save undo
    editor._pushCmd({ type: 'full', layer: 'base', before: null, after: null }); // lightweight signal
  } catch (err) { hideLoading(); toast('Erro inpaint: ' + err.message, 'error'); }
}

// Apply inpaint to the painted brush mask on inpaint layer
btnApplyInpSel?.addEventListener('click', async () => {
  showLoading('Inpainting da máscara…', 20);
  try {
    await new Promise(r => setTimeout(r, 0));
    const mask = editor.getInpaintMask();
    if (!mask.some(v => v)) { hideLoading(); toast('Pinte a área com a ferramenta Inpaint primeiro.', 'warning'); return; }
    inpaintMask(baseCanvas, mask, { feather: 4 });
    editor.clearInpaintLayer();
    hideLoading();
    btnApplyInpSel.classList.add('hidden');
    toast('Inpaint aplicado!', 'success');
  } catch (err) { hideLoading(); toast('Erro: ' + err.message, 'error'); }
});

// Inpaint from box-editor panel
btnInpaintBox?.addEventListener('click', () => {
  if (!textMgr.selectedId) return;
  const box = textMgr.boxes.get(textMgr.selectedId);
  if (!box) return;
  const d = box.data;
  inpaintRect(baseCanvas, d.x, d.y, d.w, d.h, { method: 'auto' });
  toast('Inpaint na caixa.', 'success');
});

// OCR from box-editor panel
btnOcrBox?.addEventListener('click', async () => {
  if (!textMgr.selectedId) return;
  const box = textMgr.boxes.get(textMgr.selectedId);
  if (!box) return;
  const d = box.data;
  showLoading('OCR na caixa…', 10);
  try {
    const block = await runOCRRegion(baseCanvas,
      { x: d.x, y: d.y, w: d.w, h: d.h }, ocrLang.value,
      (pct,msg) => updateLoading(msg,pct));
    if (block) {
      textMgr.update(textMgr.selectedId, { text: block.text });
      if (boxText) boxText.value = block.text;
    }
    hideLoading();
    toast(block ? `OCR: ${block.text.slice(0,30)}` : 'Sem texto.', block?'success':'warning');
  } catch (err) { hideLoading(); toast('Erro OCR: '+err.message,'error'); }
});

// ── RE-OCR per block ──────────────────────────────────────
async function _reOCRBlock(id) {
  const block = state.blocks.find(b => b.id === id);
  if (!block) return;
  showLoading('Re-OCR…', 10);
  try {
    const nb = await runOCRRegion(baseCanvas, block.bbox, ocrLang.value,
      (pct,msg)=>updateLoading(msg,pct));
    if (nb) { block.text=nb.text; block.confidence=nb.confidence; block.translation=''; }
    hideLoading(); editor.drawOverlay(state.blocks,id,state.balloons); _renderBlockList();
    toast(nb?`Re-OCR: "${nb.text.slice(0,30)}"`: 'Sem texto.', nb?'success':'warning');
  } catch (err) { hideLoading(); toast('Erro: '+err.message,'error'); }
}

// ── TRANSLATION ───────────────────────────────────────────
btnTranslate.addEventListener('click', async () => {
  if (!state.blocks.length) return;
  btnTranslate.disabled = true;
  setStep(3); showLoading('Traduzindo…', 0, `${state.blocks.length} blocos`);
  state.blocks.forEach(b => b.translating=true); _renderBlockList();
  let done = 0;
  await translateBatch(
    state.blocks.map(b=>({id:b.id,text:b.text})),
    ocrLang.value, transLang.value,
    (id,res,err) => {
      const b=state.blocks.find(x=>x.id===id); if (!b) return;
      b.translating=false;
      if (res){b.translation=res.text;b.translatedBy=res.service;}
      else {b.translationError=err?.message;}
      done++; updateBlockCard(b);
      updateLoading(`Traduzindo… ${done}/${state.blocks.length}`,(done/state.blocks.length)*100);
    },
  );
  hideLoading(); setStep(4);
  const ok=state.blocks.filter(b=>b.translation).length;
  setStatus('trans-status',`✓ ${ok}/${state.blocks.length} traduzidos.`,'success');
  toast(`${ok} traduzidos.`,'success');
  btnTranslate.disabled=false; _renderBlockList();
});

// ── BLOCK LIST ────────────────────────────────────────────
function _renderBlockList() {
  renderBlocks(state.blocks, {
    onSelect:         _selectBlock,
    onToggleVis:      (id)=>{const b=state.blocks.find(x=>x.id===id);if(b){b.visible=!b.visible;editor.drawOverlay(state.blocks,state.selectedBlock,state.balloons);_renderBlockList();}},
    onErase:          (id)=>{const b=state.blocks.find(x=>x.id===id);if(b){editor.fillRect(b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h,boxBg?.value||'#ffffff');toast('Apagado.','info');}},
    onInpaint:        _inpaintBlock,
    onReOCR:          _reOCRBlock,
    onDelete:         (id)=>{state.blocks=state.blocks.filter(b=>b.id!==id);textMgr.remove(id);editor.drawOverlay(state.blocks,state.selectedBlock,state.balloons);_renderBlockList();},
    onApply:          _applyTranslation,
    onTranslationEdit:(id,text)=>{const b=state.blocks.find(x=>x.id===id);if(b)b.translation=text;},
  });
}

function _selectBlock(id) {
  state.selectedBlock=id; highlightBlock(id);
  editor.drawOverlay(state.blocks,id,state.balloons);
  const b=state.blocks.find(x=>x.id===id);
  if (b) editor.panToCenter(b.bbox.x+b.bbox.w/2,b.bbox.y+b.bbox.h/2);
}

function _applyTranslation(id, text) {
  const b=state.blocks.find(x=>x.id===id);
  if (!b||!text){toast('Texto vazio.','warning');return;}
  const font=pickFont(b), fSize=pickFontSize(text,b.bbox,font);
  const bg=boxBg?.value||'#ffffff', bgOp=(boxOpacity?.value??90)/100;
  const col=boxColor?.value||'#000000';

  // Smart placement
  const analysis=textMgr.analyzeRegion(baseCanvas,b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h);
  b.placementWarning=analysis.score>0.4;

  // Use balloon bbox if available (better fit)
  const balloon = state.balloons.find(bl =>
    b.bbox.x>=bl.x&&b.bbox.x<=bl.x+bl.w&&b.bbox.y>=bl.y&&b.bbox.y<=bl.y+bl.h);
  const targetBox = balloon ?? b.bbox;

  editor.fillRect(b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h,bg);
  let tx=targetBox.x+2, ty=analysis.suggestion?.y??targetBox.y+2;

  textMgr.add({
    id, text, x:tx, y:ty,
    w: Math.max(targetBox.w-4,60), h: targetBox.h,
    fontSize:fSize, fontFamily:font, color:col, bgColor:bg, bgOpacity:bgOp, align:'center',
  });
  b.applied=true;
  editor.drawOverlay(state.blocks,state.selectedBlock,state.balloons);
  _renderBlockList();
  toast(b.placementWarning?`Aplicado ⚠ (cobre arte)`:`Aplicado (${font}, ${fSize}px)`,
        b.placementWarning?'warning':'success');
}

// ── TOOLS ─────────────────────────────────────────────────
toolBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tool=btn.dataset.tool, was=btn.classList.contains('active');
    toolBtns.forEach(b=>b.classList.remove('active'));
    editor.setTool(null);
    if (!was) {
      btn.classList.add('active'); editor.setTool(tool);
      _renderToolOpts(tool);
      toast(`${btn.textContent.trim()}`, 'info', 1400);
    } else { _renderToolOpts(null); }
  });
});

function _renderToolOpts(tool) {
  const opts=$('tool-options'); if (!opts) return;
  opts.innerHTML='';
  if (!tool) return;

  if (tool==='selection') {
    opts.innerHTML='<p class="tip-text">Desenhe → OCR automático na seleção</p>'; return;
  }
  if (tool==='text-box') {
    opts.innerHTML='<p class="tip-text">Desenhe o retângulo → caixa de texto criada</p>'; return;
  }
  if (tool==='inpaint') {
    opts.innerHTML='<p class="tip-text">Pinte a área → clique "🪄 Inpaint Sel" para aplicar</p>'; return;
  }
  if (tool==='clone') {
    opts.innerHTML='<p class="tip-text">Ctrl+click = fonte · Click = aplica</p>';
    editor.toast=toast;
  }

  const row=document.createElement('div');
  row.className='tool-group';
  row.innerHTML=`<label class="tool-label">Tamanho: <span id="t-sv">20</span>px</label>
    <input type="range" id="t-size" min="3" max="120" value="20" class="tool-range"/>`;
  opts.insertBefore(row, opts.firstChild);

  if (tool==='brush'||tool==='fill'||tool==='eraser') {
    const cr=document.createElement('div'); cr.className='tool-group';
    cr.innerHTML=`<label class="tool-label">Cor</label><input type="color" id="t-color" value="${tool==='eraser'?'#ffffff':'#000000'}" class="tool-color"/>`;
    opts.appendChild(cr);
    opts.querySelector('#t-color')?.addEventListener('input',e=>editor.setToolColor(e.target.value));
  }

  opts.querySelector('#t-size')?.addEventListener('input',e=>{
    editor.setToolSize(+e.target.value);
    const sv=opts.querySelector('#t-sv'); if(sv)sv.textContent=e.target.value;
  });
}

btnClearSel?.addEventListener('click',()=>{editor.clearSelection();btnClearSel.classList.add('hidden');btnApplyInpSel?.classList.add('hidden');});

// ── UNDO / REDO ───────────────────────────────────────────
btnUndo?.addEventListener('click',()=>{if(!editor.undo())toast('Nada para desfazer.','warning');});
btnRedo?.addEventListener('click',()=>{if(!editor.redo())toast('Nada para refazer.','warning');});

// ── TEXT MANUAL ───────────────────────────────────────────
btnAddText?.addEventListener('click',()=>{
  const text=newTextIn?.value.trim(); if (!text){toast('Digite o texto.','warning');return;}
  textMgr.add({ text,
    x:Math.floor(baseCanvas.width*.05), y:Math.floor(baseCanvas.height*.05),
    w:Math.floor(baseCanvas.width*.3),
    fontSize:+boxFontSize?.value||18, fontFamily:boxFontFam?.value||'Bangers',
    color:boxColor?.value||'#000000', bgColor:boxBg?.value||'#ffffff',
    bgOpacity:(boxOpacity?.value??90)/100,
    align:document.querySelector('.align-btn.active')?.dataset.align||'center',
  });
  if(newTextIn) newTextIn.value='';
  toast('Texto adicionado.','success');
});

// ── BOX EDITOR LIVE UPDATE ────────────────────────────────
function _populateBoxEditor(data) {
  if(boxText)    boxText.value    =data.text;
  if(boxFontFam) boxFontFam.value =data.fontFamily;
  if(boxFontSize)boxFontSize.value=data.fontSize;
  if(boxColor)   boxColor.value   =data.color;
  if(boxBg)      boxBg.value      =data.bgColor;
  if(boxOpacity){boxOpacity.value=Math.round(data.bgOpacity*100);if(boxOpacityV)boxOpacityV.textContent=boxOpacity.value;}
  if(boxRotation){boxRotation.value=data.rotation;if(boxRotationV)boxRotationV.textContent=data.rotation;}
  alignBtns.forEach(b=>b.classList.toggle('active',b.dataset.align===data.align));
}
let _td;
boxText?.addEventListener('input',()=>{clearTimeout(_td);_td=setTimeout(()=>textMgr.updateSelected({text:boxText.value}),60);});
boxFontFam?.addEventListener('change', ()=>textMgr.updateSelected({fontFamily:boxFontFam.value}));
boxFontSize?.addEventListener('input', ()=>textMgr.updateSelected({fontSize:+boxFontSize.value||18}));
boxColor?.addEventListener('input',    ()=>textMgr.updateSelected({color:boxColor.value}));
boxBg?.addEventListener('input',       ()=>textMgr.updateSelected({bgColor:boxBg.value}));
boxOpacity?.addEventListener('input',  ()=>{if(boxOpacityV)boxOpacityV.textContent=boxOpacity.value;textMgr.updateSelected({bgOpacity:boxOpacity.value/100});});
boxRotation?.addEventListener('input', ()=>{if(boxRotationV)boxRotationV.textContent=boxRotation.value;textMgr.updateSelected({rotation:+boxRotation.value});});
alignBtns.forEach(btn=>btn.addEventListener('click',()=>{alignBtns.forEach(b=>b.classList.remove('active'));btn.classList.add('active');textMgr.updateSelected({align:btn.dataset.align});}));
btnDeleteBox?.addEventListener('click',()=>{if(textMgr.selectedId){textMgr.remove(textMgr.selectedId);toast('Removida.','info');}});

// ── ZOOM ─────────────────────────────────────────────────
zoomRange?.addEventListener('input',()=>{editor.setScale(+zoomRange.value/100);syncZoomUI(editor.scale);});
btnFit?.addEventListener('click',()=>{if(!state.image)return;syncZoomUI(editor.fitToStage(state.image.naturalWidth,state.image.naturalHeight));});
btnZoomReset?.addEventListener('click',()=>{editor.setScale(1);if(state.image)editor.centerInStage(state.image.naturalWidth,state.image.naturalHeight);syncZoomUI(1);});
function syncZoomUI(s){if(zoomRange)zoomRange.value=Math.round(s*100);if(zoomVal)zoomVal.textContent=Math.round(s*100);}

// ── EXPORT ────────────────────────────────────────────────
btnExport?.addEventListener('click',()=>{
  showLoading('Exportando…',70);
  try {
    const url=editor.exportImage(textMgr.getAllData());
    Object.assign(document.createElement('a'),{download:`manga-${Date.now()}.png`,href:url}).click();
    setStep(5); hideLoading(); toast('Exportado!','success');
  } catch(e){hideLoading();toast('Erro: '+e.message,'error');}
});

// ── NEW IMAGE ─────────────────────────────────────────────
btnNew?.addEventListener('click', async ()=>{
  if (!confirm('Iniciar com nova imagem? O progresso será perdido.')) return;
  await terminateWorker();
  state.image=null; state.blocks=[]; state.balloons=[];
  editor.clearOverlay(); textMgr.clear();
  stage.style.display='none'; dropZone.style.display='';
  btnRunOCR.disabled=true; btnTranslate.disabled=true;
  btnAddText.disabled=true; btnDetectBal.disabled=true;
  fileInput.value='';
  clearStatus('ocr-status'); clearStatus('trans-status');
  _renderBlockList(); setStep(1);
  if (boxEditor) boxEditor.style.display='none';
});

// ── KEYBOARD ──────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  const tag=document.activeElement?.tagName;
  if (tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  const map={b:'brush',e:'eraser',u:'blur',f:'fill',c:'clone',s:'selection',i:'inpaint',t:'text-box'};
  if (map[e.key]){document.querySelector(`.tool-btn[data-tool="${map[e.key]}"]`)?.click();return;}
  if(e.ctrlKey&&e.key==='z'){e.preventDefault();btnUndo?.click();}
  if(e.ctrlKey&&e.key==='y'){e.preventDefault();btnRedo?.click();}
  if(e.ctrlKey&&e.key==='s'){e.preventDefault();btnSaveProj?.click();}
  if(e.key==='0')btnFit?.click();
  if(e.key==='1')btnZoomReset?.click();
  if((e.key==='+'||e.key==='=')&&!e.ctrlKey){editor.setScale(editor.scale*1.15);syncZoomUI(editor.scale);}
  if(e.key==='-'&&!e.ctrlKey){editor.setScale(editor.scale/1.15);syncZoomUI(editor.scale);}
  if(e.key==='Escape'){toolBtns.forEach(b=>b.classList.remove('active'));editor.setTool(null);editor.clearSelection();textMgr.deselect();_renderToolOpts(null);}
  if((e.key==='Delete'||e.key==='Backspace')&&textMgr.selectedId){textMgr.remove(textMgr.selectedId);toast('Removida.','info');}
});

// ── INIT ─────────────────────────────────────────────────
if (boxEditor) boxEditor.style.display='none';
_renderBlockList(); setStep(1);

// Start preloading OpenCV in background
waitForOpenCV(12000).then(ok => {
  if (ok) console.log('[v5] OpenCV.js pronto');
  else    console.log('[v5] OpenCV.js indisponível — usando fallback');
});

toast('MangaEasyTranslator v5 pronto!', 'info', 3500);
