/**
 * app.js — v8
 *
 * Novidades vs v7:
 *  1. OCR com máscara real de laço: getLassoMaskedCrop() → pixels fora do
 *     polígono ficam brancos antes de ir para o Tesseract.
 *  2. Ferramenta Linha OCR ("stroke"): desenha linha → detecção de ângulo →
 *     getStrokeCrop() → OCR des-rotacionado. Tecla atalho: "k".
 *  3. i18n PT/EN: botão no header alterna idioma em tempo real.
 *     Todos os textos da UI têm data-i18n correspondente no HTML.
 */

import { runOCR, runOCRCanvas, runOCRRegion, terminateWorker } from './ocr.js';
import { translateBatch }      from './translate.js';
import { CanvasEditor }        from './editor.js';
import { TextManager }         from './textManager.js';
import { pickFont, pickFontSize, FONTS } from './fontManager.js';
import { inpaintRect, inpaintMask } from './inpaint.js';
import {
  buildProject, saveProjectFile, loadProjectFile,
  restoreProject, autosave,
} from './projectManager.js';
import {
  toast, showLoading, updateLoading, hideLoading,
  setStep, setStatus, clearStatus,
  renderBlocks, updateBlockCard, highlightBlock,
} from './ui.js';
import { initLang, toggleLang, t } from './i18n.js';

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

const btnRunOCR        = $('btn-run-ocr');
const btnTranslate     = $('btn-translate-all');
const btnExport        = $('btn-export');
const btnNew           = $('btn-new');
const btnSaveProj      = $('btn-save-project');
const btnLoadProj      = $('btn-load-project');
const btnAddText       = $('btn-add-text');
const btnAddManual     = $('btn-add-manual-block');
const btnUndo          = $('btn-undo');
const btnRedo          = $('btn-redo');
const btnClearSel      = $('btn-clear-sel');
const btnApplyInpSel   = $('btn-apply-inpaint-sel');
const btnFit           = $('btn-fit');
const btnZoomReset     = $('btn-zoom-reset');
const btnDeleteBox     = $('btn-delete-box');
const btnOcrBox        = $('btn-ocr-box');
const btnInpaintBox    = $('btn-inpaint-box');
const btnAutoLayout    = $('btn-auto-layout');
const btnCopyOcr       = $('btn-copy-ocr');
const btnSelectFile    = $('btn-select-file');
const btnOcrSel        = $('btn-ocr-sel');
const btnClearSel2     = $('btn-clear-sel2');
const btnLangToggle    = $('btn-lang-toggle');

const toolBtns    = document.querySelectorAll('.tool-btn[data-tool]');
const ocrLang     = $('ocr-lang');
const ocrPsm      = $('ocr-psm');
const transLang   = $('trans-lang');
const zoomRange   = $('zoom-range');
const zoomVal     = $('zoom-val');
const newTextIn   = $('new-text-input');
const boxEditor   = $('box-editor');
const boxIdLabel  = $('box-id-label');
const boxOcrText  = $('box-ocr-text');
const boxText     = $('box-text');
const boxFontFam  = $('box-font-family');
const boxFontSize = $('box-font-size');
const boxFontAuto = $('box-font-auto');
const boxColor    = $('box-color');
const boxBg       = $('box-bg');
const boxOpacity  = $('box-opacity');
const boxOpacityV = $('box-opacity-val');
const boxRotation = $('box-rotation');
const boxRotationV= $('box-rotation-val');
const alignBtns   = document.querySelectorAll('.align-btn');
const selToolbar  = $('sel-toolbar');
const selAngleInp = $('sel-angle');
const selAngleVal = $('sel-angle-val');

// ── i18n init ─────────────────────────────────────────────
initLang();

btnLangToggle?.addEventListener('click', () => {
  toggleLang();
  // Re-render hints dinâmicos que não são cobertos pelo data-i18n
  _renderBlockList();
});

// ── Populate font select ──────────────────────────────────
if (boxFontFam)
  boxFontFam.innerHTML = FONTS.map(f=>`<option value="${f.name}">${f.label}</option>`).join('');

// ── STATE ─────────────────────────────────────────────────
const state = {
  image:         null,
  blocks:        [],
  selectedBlock: null,
  _blockCounter: 0,
};

// ── MODULES ───────────────────────────────────────────────
const editor = new CanvasEditor({
  stage, world, base: baseCanvas,
  inpaint: inpCanvas, selection: selCanvas, overlay: ovrCanvas,
});
const textMgr = new TextManager(textLayer, prvCanvas, editor);
editor.onZoomChange = syncZoomUI;

editor.onSelectionChange = (data, tool) => {
  if (!data) {
    _hideSelToolbar(); btnClearSel?.classList.add('hidden');
    btnApplyInpSel?.classList.add('hidden'); return;
  }
  btnClearSel?.classList.toggle('hidden', false);
  btnApplyInpSel?.classList.toggle('hidden', tool !== 'inpaint');

  if (tool === 'selection')  _showSelToolbar(data.rect);
  if (tool === 'lasso')      _handleLassoOCR(data);
  if (tool === 'text-box')   _createTextBoxFromRect(data.rect);
  if (tool === 'stroke')     _handleStrokeOCR(data);
};

textMgr.onSelect = (id, data) => {
  state.selectedBlock = id;
  highlightBlock(id);
  if (boxEditor)  boxEditor.style.display = '';
  if (boxIdLabel) boxIdLabel.textContent  = `#${id.split('-')[1]??id}`;
  _populateBoxEditor(data);
};
textMgr.onDeselect = () => {
  if (boxEditor) boxEditor.style.display = 'none';
  state.selectedBlock = null;
};

// ── SELECTION TOOLBAR ─────────────────────────────────────
let _currentSelRect = null;

function _showSelToolbar(rect) {
  _currentSelRect = rect;
  if (!selToolbar) return;
  selToolbar.classList.remove('hidden');
  if (selAngleInp) selAngleInp.value = 0;
  if (selAngleVal) selAngleVal.textContent = '0';
}
function _hideSelToolbar() {
  _currentSelRect = null;
  selToolbar?.classList.add('hidden');
  if (selAngleInp) selAngleInp.value = 0;
  if (selAngleVal) selAngleVal.textContent = '0';
  editor.setSelAngle(0);
}

selAngleInp?.addEventListener('input', () => {
  const deg = +selAngleInp.value;
  if (selAngleVal) selAngleVal.textContent = deg;
  editor.setSelAngle(deg);
});

btnOcrSel?.addEventListener('click', async () => {
  if (!_currentSelRect) return;
  const deg = +selAngleInp?.value || 0;
  showLoading(t('loading-ocr-sel'), 10, deg ? `${deg}°` : '');
  try {
    const croppedCanvas = editor.getRotatedCrop(_currentSelRect, deg);
    const block = await runOCRCanvas(croppedCanvas, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct), '6');
    if (!block) { hideLoading(); toast(t('toast-no-text'), 'warning'); return; }
    block.bbox  = { ..._currentSelRect };
    block.angle = deg;
    state.blocks.push(block);
    state._blockCounter++;
    hideLoading();
    editor.drawOverlay(state.blocks, block.id);
    _renderBlockList();
    toast(`OCR: "${block.text.slice(0,35)}…"`, 'success');
    _hideSelToolbar();
    editor.clearSelection();
    btnClearSel?.classList.add('hidden');
    _deactivateAllTools();
  } catch(err) { hideLoading(); toast('Erro OCR: '+err.message,'error'); }
});

btnClearSel2?.addEventListener('click', () => {
  editor.clearSelection(); _hideSelToolbar();
  btnClearSel?.classList.add('hidden');
});

// ── LASSO OCR — COM MÁSCARA REAL ─────────────────────────
async function _handleLassoOCR(data) {
  if (!data?.points?.length || data.points.length < 3) return;
  if (!data.rect || data.rect.w < 10 || data.rect.h < 10) return;

  showLoading(t('loading-ocr-lasso'), 10);
  try {
    // NOVO: usa máscara real do polígono — pixels fora ficam brancos
    const maskedCanvas = editor.getLassoMaskedCrop(data.points);
    const block = await runOCRCanvas(
      maskedCanvas, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct), '6'
    );
    if (!block) { hideLoading(); toast(t('toast-no-text'), 'warning'); return; }
    block.bbox = { ...data.rect };
    state.blocks.push(block);
    hideLoading();
    editor.drawOverlay(state.blocks, block.id);
    _renderBlockList();
    toast(`OCR laço: "${block.text.slice(0,30)}"`, 'success');
    editor.clearSelection();
    btnClearSel?.classList.add('hidden');
    _deactivateAllTools();
  } catch(err) { hideLoading(); toast('Erro: '+err.message,'error'); }
}

// ── STROKE OCR — LINHA + ÂNGULO AUTOMÁTICO ────────────────
async function _handleStrokeOCR(data) {
  if (!data?.points?.length || !data.rect) return;
  const [p1, p2] = data.points;
  if (!p1 || !p2) return;

  showLoading(t('loading-ocr-stroke'), 20);
  try {
    // getStrokeCrop: extrai faixa ao redor da linha, já des-rotacionada
    const THICKNESS = Math.max(60, Math.floor(Math.hypot(
      data.rect.w, data.rect.h
    ) * 0.6));
    const { canvas: strokeCanvas, angle, rect } = editor.getStrokeCrop(p1, p2, THICKNESS);

    const block = await runOCRCanvas(
      strokeCanvas, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct), '7' // PSM 7 = linha única (ideal para stroke)
    );
    if (!block) { hideLoading(); toast(t('toast-no-text'), 'warning'); return; }
    block.bbox  = rect;
    block.angle = data.angle;  // ângulo detectado da linha

    state.blocks.push(block);
    state._blockCounter++;
    hideLoading();
    editor.drawOverlay(state.blocks, block.id);
    _renderBlockList();

    const deg = Math.round(data.angle);
    toast(`Linha OCR (${deg}°): "${block.text.slice(0,30)}"`, 'success');
    editor.clearSelection();
    btnClearSel?.classList.add('hidden');
    _deactivateAllTools();
  } catch(err) { hideLoading(); toast('Erro linha OCR: '+err.message,'error'); }
}

// ── LAYER VISIBILITY ─────────────────────────────────────
document.querySelectorAll('.layer-eye').forEach(eye => {
  eye.addEventListener('click', (e) => {
    e.stopPropagation();
    const layer = eye.dataset.layer;
    const item  = eye.closest('.layer-item');
    const hidden = item.classList.toggle('hidden-layer');
    eye.textContent = hidden ? '🙈' : '👁';
    if (layer==='base'||layer==='inpaint'||layer==='overlay')
      editor.setLayerVisible(layer, !hidden);
    if (layer==='text') {
      textLayer.style.opacity  = hidden ? '0' : '';
      prvCanvas.style.opacity  = hidden ? '0' : '';
    }
  });
});

// ── FILE UPLOAD ───────────────────────────────────────────
btnSelectFile?.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('click', (e) => { if(e.target.closest('.drop-content')&&!e.target.matches('a')) fileInput.click(); });
dropZone.addEventListener('dragover',  (e)=>{e.preventDefault();dropZone.classList.add('drag-over');});
dropZone.addEventListener('dragleave', ()=>dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e)=>{
  e.preventDefault();dropZone.classList.remove('drag-over');
  const f=e.dataTransfer.files[0];
  if(f?.name.endsWith('.met')||f?.type==='application/json') _doLoadProject(f);
  else if(f?.type.startsWith('image/')) _loadImageFile(f);
  else toast('Use JPG/PNG ou .met','error');
});
fileInput.addEventListener('change',()=>{if(fileInput.files[0])_loadImageFile(fileInput.files[0]);});

async function _loadImageFile(file) {
  const reader=new FileReader();
  reader.onload=(ev)=>{
    const img=new Image();
    img.onload=async()=>{await _initWithImage(img);toast(t('toast-img-loaded'),'success');};
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function _initWithImage(img) {
  state.image=img; state.blocks=[]; state._blockCounter=0;
  await terminateWorker();
  editor.loadImage(img);
  [selCanvas,ovrCanvas,prvCanvas].forEach(c=>{c.width=img.naturalWidth;c.height=img.naturalHeight;});
  inpCanvas.width=img.naturalWidth; inpCanvas.height=img.naturalHeight;
  textMgr.syncPreviewSize(img.naturalWidth,img.naturalHeight);
  stage.style.display=''; dropZone.style.display='none';
  syncZoomUI(editor.fitToStage(img.naturalWidth,img.naturalHeight));
  btnRunOCR.disabled  = false;
  btnAddText.disabled = false;
  btnExport.disabled  = false;
  btnTranslate.disabled = false;
  setStep(2);
  toast(t('toast-img-hint'), 'info', 4500);
}

// ── PROJECT SAVE/LOAD ─────────────────────────────────────
btnSaveProj?.addEventListener('click',()=>{
  if(!state.image){toast(t('toast-no-image'),'warning');return;}
  const proj=buildProject({
    baseCanvas, inpaintCanvas:inpCanvas,
    blocks:state.blocks, textBoxes:textMgr.getAllData(),
    balloons:[], meta:{lang:ocrLang.value, transLang:transLang.value},
  });
  autosave(proj); saveProjectFile(proj);
  toast(t('toast-saved'),'success');
});
btnLoadProj?.addEventListener('click',()=>projInput.click());
$('link-load-project')?.addEventListener('click',(e)=>{e.preventDefault();projInput.click();});
projInput?.addEventListener('change',async()=>{if(projInput.files[0])await _doLoadProject(projInput.files[0]);});

async function _doLoadProject(file){
  showLoading(t('loading-project'),30);
  try{
    const proj=await loadProjectFile(file);
    const{image,blocks,textBoxes,meta}=await restoreProject(proj,{baseCanvas,inpaintCanvas:inpCanvas});
    await _initWithImage(image);
    state.blocks=blocks;
    if(meta?.lang)      ocrLang.value  =meta.lang;
    if(meta?.transLang) transLang.value=meta.transLang;
    textMgr.clear();
    for(const box of textBoxes) textMgr.add(box);
    editor.drawOverlay(state.blocks,null);
    _renderBlockList();
    hideLoading();
    toast(`${t('toast-loaded')} — ${blocks.length} blocos, ${textBoxes.length} caixas`,'success');
    if(blocks.length) setStep(3);
  }catch(err){hideLoading();toast('Erro: '+err.message,'error');}
}

// ── OCR (opcional) ────────────────────────────────────────
btnRunOCR.addEventListener('click',async()=>{
  if(!state.image) return;
  btnRunOCR.disabled=true;
  showLoading(t('loading-ocr-page'),0,t('loading-ocr-first'));
  setStep(2);
  try{
    const blocks=await runOCR(baseCanvas,ocrLang.value,(pct,msg)=>updateLoading(msg,pct),ocrPsm?.value||'11');
    state.blocks=blocks;
    hideLoading(); setStep(3);
    if(!blocks.length){
      setStatus('ocr-status',t('status-ocr-empty'),'warning');
      toast(t('toast-ocr-empty'),'warning');
    } else {
      setStatus('ocr-status',`✓ ${blocks.length} ${t('status-ocr-done')}`,'success');
      toast(`${blocks.length} ${t('toast-blocks-found')}`,'success');
    }
    editor.drawOverlay(blocks,null);
    _renderBlockList();
  }catch(err){
    hideLoading();setStatus('ocr-status',`Erro: ${err.message}`,'error');
    toast('Erro OCR: '+err.message,'error');
  }finally{btnRunOCR.disabled=false;}
});

// ── MANUAL BLOCK ─────────────────────────────────────────
btnAddManual?.addEventListener('click',()=>{
  state._blockCounter++;
  const num=state._blockCounter;
  const id =`block-m${num}`;
  const W=baseCanvas.width||800, H=baseCanvas.height||1200;
  const block={
    id, text:'', confidence:100,
    bbox:{x:Math.floor(W*.05),y:Math.floor(H*.05+num*60),w:Math.floor(W*.4),h:50},
    translation:'',visible:true,applied:false,manual:true,
  };
  state.blocks.push(block);
  editor.drawOverlay(state.blocks,id);
  _renderBlockList();
  toast(`${t('toast-manual-block')} #${num}`,'info');
});

// ── TEXT-BOX TOOL ────────────────────────────────────────
function _createTextBoxFromRect(rect){
  if(rect.w<20||rect.h<20) return;
  const fam   = boxFontFam?.value || 'Bangers';
  const fSize = pickFontSize('…', {w:rect.w, h:rect.h}, fam);
  textMgr.add({
    x:rect.x, y:rect.y, w:rect.w, h:rect.h,
    text:'…', fontSize:fSize, fontFamily:fam,
    color:  boxColor?.value  || '#000000',
    bgColor:boxBg?.value     || '#ffffff',
    bgOpacity: (boxOpacity?.value ?? 90) / 100,
    align:'center',
  });
  editor.clearSelection();
  _deactivateAllTools();
  toast(t('toast-box-created'),'success');
}

// ── TRANSLATION ───────────────────────────────────────────
btnTranslate.addEventListener('click',async()=>{
  const translatable = state.blocks.filter(b => b.text?.trim());
  if(!translatable.length){
    toast(t('toast-no-translatable'),'warning'); return;
  }
  btnTranslate.disabled=true; setStep(3);
  showLoading(t('loading-translate'),0,`${translatable.length} ${t('loading-blocks')}`);
  translatable.forEach(b=>{b.translating=true;}); _renderBlockList();
  let done=0;
  await translateBatch(
    translatable.map(b=>({id:b.id,text:b.text})),
    ocrLang.value, transLang.value,
    (id,res,err)=>{
      const b=state.blocks.find(x=>x.id===id); if(!b)return;
      b.translating=false;
      if(res){b.translation=res.text; b.translatedBy=res.service;}
      else    b.translationError=err?.message;
      done++; updateBlockCard(b);
      updateLoading(`${t('loading-translating')} ${done}/${translatable.length}`,(done/translatable.length)*100);
    });
  hideLoading(); setStep(4);
  const ok=state.blocks.filter(b=>b.translation).length;
  setStatus('trans-status',`✓ ${ok}/${state.blocks.length} ${t('status-translated')}`,'success');
  toast(`${ok} ${t('toast-translated')}`,'success');
  btnTranslate.disabled=false; _renderBlockList();
});

// ── BLOCK LIST ────────────────────────────────────────────
function _renderBlockList(){
  renderBlocks(state.blocks,{
    onSelect:         _selectBlock,
    onToggleVis:      (id)=>{const b=state.blocks.find(x=>x.id===id);if(b){b.visible=!b.visible;editor.drawOverlay(state.blocks,state.selectedBlock);_renderBlockList();}},
    onErase:          (id)=>{const b=state.blocks.find(x=>x.id===id);if(b){editor.fillRect(b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h,boxBg?.value||'#ffffff');toast(t('toast-erased'),'info');}},
    onInpaint:        _inpaintBlock,
    onReOCR:          _reOCRBlock,
    onDelete:         (id)=>{state.blocks=state.blocks.filter(b=>b.id!==id);textMgr.remove(id);editor.drawOverlay(state.blocks,state.selectedBlock);_renderBlockList();},
    onApply:          _applyTranslation,
    onOcrEdit:        (id,text)=>{const b=state.blocks.find(x=>x.id===id);if(b) b.text=text;},
    onTranslationEdit:(id,text)=>{const b=state.blocks.find(x=>x.id===id);if(b) b.translation=text;},
  });
}

function _selectBlock(id){
  state.selectedBlock=id; highlightBlock(id);
  editor.drawOverlay(state.blocks,id);
  const b=state.blocks.find(x=>x.id===id);
  if(b) editor.panToCenter(b.bbox.x+b.bbox.w/2, b.bbox.y+b.bbox.h/2);
}

// ── APPLY TRANSLATION ─────────────────────────────────────
function _applyTranslation(id, text){
  const b=state.blocks.find(x=>x.id===id);
  if(!b||!text?.trim()){toast(t('toast-empty-text'),'warning');return;}

  const useAuto = boxFontAuto?.checked !== false;
  const font  = useAuto
    ? pickFont({text, bbox:b.bbox})
    : (boxFontFam?.value || pickFont({text, bbox:b.bbox}));
  const col   = boxColor?.value  || '#000000';
  const bg    = boxBg?.value     || '#ffffff';
  const bgOp  = (boxOpacity?.value ?? 90) / 100;
  const align = document.querySelector('.align-btn.active')?.dataset.align || 'center';
  const fSize = useAuto
    ? pickFontSize(text, {w: b.bbox.w, h: b.bbox.h}, font)
    : (+boxFontSize?.value || 18);

  editor.fillRect(b.bbox.x, b.bbox.y, b.bbox.w, b.bbox.h, bg);
  textMgr.add({
    id, text,
    x: b.bbox.x, y: b.bbox.y,
    w: Math.max(b.bbox.w - 4, 60), h: b.bbox.h,
    fontSize: fSize, fontFamily: font,
    color: col, bgColor: bg, bgOpacity: bgOp, align,
  });

  b.applied = true;
  editor.drawOverlay(state.blocks, state.selectedBlock);
  _renderBlockList();
  toast(`${t('toast-applied')} — ${font} ${fSize}px`, 'success');
}

// ── INPAINT ───────────────────────────────────────────────
async function _inpaintBlock(id){
  const b=state.blocks.find(x=>x.id===id); if(!b) return;
  showLoading(t('loading-inpaint'),30);
  try{
    await new Promise(r=>setTimeout(r,0));
    inpaintRect(baseCanvas,b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h,
      {method: b.bbox.w*b.bbox.h>4000 ? 'patch' : 'telea'});
    hideLoading(); toast(t('toast-inpainted'),'success');
  }catch(err){hideLoading(); toast('Erro: '+err.message,'error');}
}

btnApplyInpSel?.addEventListener('click',async()=>{
  showLoading(t('loading-inpaint'),20);
  try{
    await new Promise(r=>setTimeout(r,0));
    const mask=editor.getInpaintMask();
    if(!mask.some(v=>v)){hideLoading();toast(t('toast-paint-first'),'warning');return;}
    inpaintMask(baseCanvas,mask,{feather:4});
    editor.clearInpaintLayer();
    hideLoading(); btnApplyInpSel.classList.add('hidden');
    toast(t('toast-inpainted'),'success');
  }catch(err){hideLoading(); toast('Erro: '+err.message,'error');}
});

btnInpaintBox?.addEventListener('click',()=>{
  if(!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId); if(!box) return;
  const d=box.data;
  inpaintRect(baseCanvas,d.x,d.y,d.w,d.h,{method:'auto'});
  toast(t('toast-inpainted'),'success');
});

// ── RE-OCR ────────────────────────────────────────────────
async function _reOCRBlock(id){
  const block=state.blocks.find(b=>b.id===id); if(!block) return;
  showLoading(t('loading-reocr'),10);
  try{
    const nb=await runOCRRegion(baseCanvas,block.bbox,ocrLang.value,(pct,msg)=>updateLoading(msg,pct));
    if(nb){block.text=nb.text; block.confidence=nb.confidence; block.translation='';}
    hideLoading(); editor.drawOverlay(state.blocks,id); _renderBlockList();
    toast(nb?`Re-OCR: "${nb.text.slice(0,30)}"`: t('toast-no-text'), nb?'success':'warning');
  }catch(err){hideLoading(); toast('Erro: '+err.message,'error');}
}

// ── OCR on selected box ───────────────────────────────────
btnOcrBox?.addEventListener('click',async()=>{
  if(!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId); if(!box) return;
  const d=box.data;
  showLoading('OCR…',10);
  try{
    const block=await runOCRRegion(baseCanvas,{x:d.x,y:d.y,w:d.w,h:d.h},ocrLang.value,(pct,msg)=>updateLoading(msg,pct));
    if(block){
      textMgr.update(textMgr.selectedId,{text:block.text});
      if(boxText)    boxText.value    = block.text;
      if(boxOcrText) boxOcrText.value = block.text;
    }
    hideLoading(); toast(block?`OCR: ${block.text.slice(0,30)}`:t('toast-no-text'),block?'success':'warning');
  }catch(err){hideLoading(); toast('Erro: '+err.message,'error');}
});

btnCopyOcr?.addEventListener('click',()=>{
  if(boxOcrText&&boxText) boxText.value=boxOcrText.value;
  textMgr.updateSelected({text:boxText?.value||''});
});

// ── AUTO LAYOUT ───────────────────────────────────────────
btnAutoLayout?.addEventListener('click',()=>{
  if(!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId); if(!box) return;
  const d=box.data;
  const font =pickFont({text:d.text, bbox:{w:d.w,h:d.h}});
  const fSize=pickFontSize(d.text,{w:d.w,h:d.h},font);
  textMgr.update(textMgr.selectedId,{fontFamily:font, fontSize:fSize});
  if(boxFontFam)  boxFontFam.value  =font;
  if(boxFontSize) boxFontSize.value =fSize;
  toast(`Auto layout: ${font} ${fSize}px`,'info');
});

// ── TOOLS ─────────────────────────────────────────────────
toolBtns.forEach(btn=>{
  btn.addEventListener('click',()=>{
    const tool=btn.dataset.tool, was=btn.classList.contains('active');
    toolBtns.forEach(b=>b.classList.remove('active'));
    editor.setTool(null);
    if(!was){
      btn.classList.add('active'); editor.setTool(tool);
      _renderToolOpts(tool);
    }else _renderToolOpts(null);
  });
});

function _deactivateAllTools(){
  toolBtns.forEach(b=>b.classList.remove('active'));
  editor.setTool(null);
  _renderToolOpts(null);
}

function _renderToolOpts(tool){
  const opts=$('tool-options'); if(!opts) return;
  opts.innerHTML='';
  if(!tool) return;
  if(tool==='selection') {opts.innerHTML=`<p class="tip-text">${t('tip-selection')}</p>`;return;}
  if(tool==='lasso')     {opts.innerHTML=`<p class="tip-text">${t('tip-lasso')}</p>`;return;}
  if(tool==='text-box')  {opts.innerHTML=`<p class="tip-text">${t('tip-textbox')}</p>`;return;}
  if(tool==='inpaint')   {opts.innerHTML=`<p class="tip-text">${t('tip-inpaint')}</p>`;return;}
  if(tool==='clone')     {opts.innerHTML=`<p class="tip-text">${t('tip-clone')}</p>`;editor.toast=toast;}
  if(tool==='stroke')    {opts.innerHTML=`<p class="tip-text">${t('tip-stroke')}</p>`;return;}

  const row=document.createElement('div'); row.className='tool-group';
  row.innerHTML=`<label class="tool-label">${t('lbl-size-px')}: <span id="t-sv">20</span>px</label>
    <input type="range" id="t-size" min="3" max="120" value="20" class="tool-range"/>`;
  opts.insertBefore(row,opts.firstChild);

  if(tool==='brush'||tool==='fill'||tool==='eraser'){
    const cr=document.createElement('div'); cr.className='tool-group';
    cr.innerHTML=`<label class="tool-label">${t('lbl-color')}</label><input type="color" id="t-color" value="${tool==='eraser'?'#ffffff':'#000000'}" class="tool-color"/>`;
    opts.appendChild(cr);
    opts.querySelector('#t-color')?.addEventListener('input',e=>editor.setToolColor(e.target.value));
  }
  opts.querySelector('#t-size')?.addEventListener('input',e=>{
    editor.setToolSize(+e.target.value);
    const sv=opts.querySelector('#t-sv'); if(sv) sv.textContent=e.target.value;
  });
}

btnClearSel?.addEventListener('click',()=>{
  editor.clearSelection(); _hideSelToolbar();
  btnClearSel.classList.add('hidden'); btnApplyInpSel?.classList.add('hidden');
});

// ── UNDO/REDO ─────────────────────────────────────────────
btnUndo?.addEventListener('click',()=>{if(!editor.undo())toast(t('toast-nothing'),'warning');});
btnRedo?.addEventListener('click',()=>{if(!editor.redo())toast(t('toast-nothing'),'warning');});

// ── TEXTO MANUAL ─────────────────────────────────────────
btnAddText?.addEventListener('click',()=>{
  const text=newTextIn?.value.trim(); if(!text){toast(t('toast-type-text'),'warning');return;}
  const fam=boxFontFam?.value||'Bangers';
  const w=Math.floor(baseCanvas.width*.3);
  const h=Math.max(60, Math.floor(baseCanvas.height*.05));
  const fsz=boxFontAuto?.checked
    ? pickFontSize(text,{w,h},fam)
    : +boxFontSize?.value||18;
  textMgr.add({text,
    x:Math.floor(baseCanvas.width*.05), y:Math.floor(baseCanvas.height*.05),
    w, h,
    fontSize:fsz, fontFamily:fam,
    color:  boxColor?.value  || '#000000',
    bgColor:boxBg?.value     || '#ffffff',
    bgOpacity:(boxOpacity?.value??90)/100,
    align: document.querySelector('.align-btn.active')?.dataset.align||'center',
  });
  if(newTextIn) newTextIn.value='';
  toast(t('toast-box-added'),'success');
});

// ── BOX EDITOR LIVE UPDATE ────────────────────────────────
function _populateBoxEditor(data){
  if(boxOcrText){
    const block=state.blocks.find(b=>b.id===data.id);
    boxOcrText.value=block?.text||'';
  }
  if(boxText)    boxText.value    = data.text;
  if(boxFontFam) boxFontFam.value = data.fontFamily;
  if(boxFontSize)boxFontSize.value= data.fontSize;
  if(boxColor)   boxColor.value   = data.color;
  if(boxBg)      boxBg.value      = data.bgColor;
  if(boxOpacity){
    boxOpacity.value=Math.round(data.bgOpacity*100);
    if(boxOpacityV) boxOpacityV.textContent=boxOpacity.value;
  }
  if(boxRotation){
    boxRotation.value = data.rotation ?? 0;
    if(boxRotationV) boxRotationV.textContent = data.rotation ?? 0;
  }
  alignBtns.forEach(b=>b.classList.toggle('active',b.dataset.align===data.align));
}

let _td;
boxText?.addEventListener('input',()=>{
  clearTimeout(_td);_td=setTimeout(()=>textMgr.updateSelected({text:boxText.value}),60);
  if(boxFontAuto?.checked && textMgr.selectedId){
    const box=textMgr.boxes.get(textMgr.selectedId);
    if(box){
      const fSize=pickFontSize(boxText.value,{w:box.data.w,h:box.data.h},box.data.fontFamily);
      textMgr.updateSelected({fontSize:fSize});
      if(boxFontSize) boxFontSize.value=fSize;
    }
  }
});

boxFontFam?.addEventListener('change',()=>{ textMgr.updateSelected({fontFamily:boxFontFam.value}); _recalcAutoSize(); });
boxFontSize?.addEventListener('input',()=>{ if(!boxFontAuto?.checked) textMgr.updateSelected({fontSize:+boxFontSize.value||18}); });
boxColor?.addEventListener('input',   ()=>textMgr.updateSelected({color:boxColor.value}));
boxBg?.addEventListener('input',      ()=>textMgr.updateSelected({bgColor:boxBg.value}));
boxOpacity?.addEventListener('input', ()=>{if(boxOpacityV)boxOpacityV.textContent=boxOpacity.value;textMgr.updateSelected({bgOpacity:boxOpacity.value/100});});
boxRotation?.addEventListener('input',()=>{if(boxRotationV)boxRotationV.textContent=boxRotation.value;textMgr.updateSelected({rotation:+boxRotation.value});});
alignBtns.forEach(btn=>btn.addEventListener('click',()=>{alignBtns.forEach(b=>b.classList.remove('active'));btn.classList.add('active');textMgr.updateSelected({align:btn.dataset.align});}));
btnDeleteBox?.addEventListener('click',()=>{if(textMgr.selectedId){textMgr.remove(textMgr.selectedId);toast(t('toast-box-removed'),'info');}});

function _recalcAutoSize(){
  if(!boxFontAuto?.checked||!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId); if(!box) return;
  const fSize=pickFontSize(box.data.text,{w:box.data.w,h:box.data.h},box.data.fontFamily);
  textMgr.updateSelected({fontSize:fSize});
  if(boxFontSize) boxFontSize.value=fSize;
}

// ── ZOOM ─────────────────────────────────────────────────
zoomRange?.addEventListener('input',()=>{editor.setScale(+zoomRange.value/100);syncZoomUI(editor.scale);});
btnFit?.addEventListener('click',()=>{if(!state.image)return;syncZoomUI(editor.fitToStage(state.image.naturalWidth,state.image.naturalHeight));});
btnZoomReset?.addEventListener('click',()=>{editor.setScale(1);if(state.image)editor.centerInStage(state.image.naturalWidth,state.image.naturalHeight);syncZoomUI(1);});
function syncZoomUI(s){if(zoomRange)zoomRange.value=Math.round(s*100);if(zoomVal)zoomVal.textContent=Math.round(s*100);}

// ── EXPORT ───────────────────────────────────────────────
btnExport?.addEventListener('click',()=>{
  showLoading(t('loading-export'),70);
  try{
    const url=editor.exportImage(textMgr.getAllData());
    Object.assign(document.createElement('a'),{download:`manga-${Date.now()}.png`,href:url}).click();
    setStep(5); hideLoading(); toast(t('toast-exported'),'success');
  }catch(e){hideLoading(); toast('Erro: '+e.message,'error');}
});

// ── NEW IMAGE ────────────────────────────────────────────
btnNew?.addEventListener('click',async()=>{
  if(!confirm(t('confirm-new'))) return;
  await terminateWorker();
  state.image=null; state.blocks=[];
  editor.clearOverlay(); textMgr.clear();
  stage.style.display='none'; dropZone.style.display='';
  btnRunOCR.disabled=true; btnTranslate.disabled=true;
  btnAddText.disabled=true; btnExport.disabled=true;
  fileInput.value='';
  clearStatus('ocr-status'); clearStatus('trans-status');
  _renderBlockList(); setStep(1);
  if(boxEditor) boxEditor.style.display='none';
  _hideSelToolbar();
});

// ── KEYBOARD ─────────────────────────────────────────────
document.addEventListener('keydown',(e)=>{
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  // 'k' = stroke/linha OCR
  const map={b:'brush',e:'eraser',u:'blur',f:'fill',c:'clone',s:'selection',l:'lasso',k:'stroke',i:'inpaint',t:'text-box'};
  if(map[e.key]){document.querySelector(`.tool-btn[data-tool="${map[e.key]}"]`)?.click();return;}
  if(e.ctrlKey&&e.key==='z'){e.preventDefault();btnUndo?.click();}
  if(e.ctrlKey&&e.key==='y'){e.preventDefault();btnRedo?.click();}
  if(e.ctrlKey&&e.key==='s'){e.preventDefault();btnSaveProj?.click();}
  if(e.key==='0') btnFit?.click();
  if(e.key==='1') btnZoomReset?.click();
  if((e.key==='+'||e.key==='=')&&!e.ctrlKey){editor.setScale(editor.scale*1.15);syncZoomUI(editor.scale);}
  if(e.key==='-'&&!e.ctrlKey){editor.setScale(editor.scale/1.15);syncZoomUI(editor.scale);}
  if(e.key==='Escape'){
    _deactivateAllTools(); editor.clearSelection();
    textMgr.deselect(); _hideSelToolbar();
  }
  if((e.key==='Delete'||e.key==='Backspace')&&textMgr.selectedId){
    textMgr.remove(textMgr.selectedId); toast(t('toast-box-removed'),'info');
  }
});

// ── INIT ────────────────────────────────────────────────
if(boxEditor) boxEditor.style.display='none';
_renderBlockList(); setStep(1);

toast('MangaEasyTranslator v8 🚀','info',3000);

// ── STRINGS i18n USADAS NO JS ────────────────────────────
// Centraliza todas as chaves que não têm data-i18n no HTML mas são usadas via t()
// O i18n.js já tem PT; aqui adicionamos as chaves EN que faltam.
import { LANGS } from './i18n.js';
Object.assign(LANGS.pt, {
  'loading-ocr-sel':    'OCR da seleção…',
  'loading-ocr-lasso':  'OCR do laço (com máscara)…',
  'loading-ocr-stroke': 'Linha OCR…',
  'loading-ocr-page':   'Iniciando OCR…',
  'loading-ocr-first':  '1ª vez: aguarde (~15 MB)',
  'loading-project':    'Carregando projeto…',
  'loading-translate':  'Traduzindo…',
  'loading-blocks':     'blocos',
  'loading-translating':'Traduzindo…',
  'loading-inpaint':    'Inpainting…',
  'loading-reocr':      'Re-OCR…',
  'loading-export':     'Exportando…',
  'toast-no-text':      'Sem texto detectado.',
  'toast-img-loaded':   'Imagem carregada!',
  'toast-img-hint':     'Use OCR ou adicione blocos manualmente.',
  'toast-no-image':     'Nenhuma imagem carregada.',
  'toast-saved':        'Projeto salvo!',
  'toast-loaded':       'Carregado',
  'toast-ocr-empty':    'OCR sem resultado. Adicione blocos manualmente.',
  'toast-blocks-found': 'blocos detectados!',
  'toast-manual-block': 'Bloco manual',
  'toast-box-created':  'Caixa criada. Edite no painel.',
  'toast-no-translatable':'Nenhum bloco com texto para traduzir.',
  'toast-erased':       'Área apagada.',
  'toast-inpainted':    'Inpaint aplicado!',
  'toast-paint-first':  'Pinte antes de aplicar.',
  'toast-applied':      'Aplicado',
  'toast-empty-text':   'Texto vazio.',
  'toast-nothing':      'Nada para fazer.',
  'toast-type-text':    'Digite o texto.',
  'toast-box-added':    'Caixa adicionada.',
  'toast-box-removed':  'Caixa removida.',
  'toast-exported':     'Exportado!',
  'status-ocr-empty':   'Nenhum texto detectado.',
  'status-ocr-done':    'blocos detectados.',
  'status-translated':  'traduzidos.',
  'toast-translated':   'traduzidos.',
  'confirm-new':        'Iniciar com nova imagem? O progresso será perdido.',
  'tip-selection':      'Desenhe → barra de ângulo + botão OCR',
  'tip-lasso':          'Click=ponto · Duplo-click=fechar · Clique-direito=fechar',
  'tip-textbox':        'Desenhe o retângulo → caixa criada',
  'tip-inpaint':        'Pinte a área → clique 🪄 Inpaint',
  'tip-clone':          'Ctrl+click=fonte · Click=clona',
  'tip-stroke':         'Clique e arraste sobre o texto → OCR automático pelo ângulo',
  'lbl-size-px':        'Tamanho',
});
Object.assign(LANGS.en, {
  'loading-ocr-sel':    'Selection OCR…',
  'loading-ocr-lasso':  'Lasso OCR (masked)…',
  'loading-ocr-stroke': 'Line OCR…',
  'loading-ocr-page':   'Starting OCR…',
  'loading-ocr-first':  'First run: please wait (~15 MB)',
  'loading-project':    'Loading project…',
  'loading-translate':  'Translating…',
  'loading-blocks':     'blocks',
  'loading-translating':'Translating…',
  'loading-inpaint':    'Inpainting…',
  'loading-reocr':      'Re-OCR…',
  'loading-export':     'Exporting…',
  'toast-no-text':      'No text detected.',
  'toast-img-loaded':   'Image loaded!',
  'toast-img-hint':     'Use OCR or add blocks manually.',
  'toast-no-image':     'No image loaded.',
  'toast-saved':        'Project saved!',
  'toast-loaded':       'Loaded',
  'toast-ocr-empty':    'OCR returned nothing. Add blocks manually.',
  'toast-blocks-found': 'blocks detected!',
  'toast-manual-block': 'Manual block',
  'toast-box-created':  'Box created. Edit in panel.',
  'toast-no-translatable':'No blocks with text to translate.',
  'toast-erased':       'Area erased.',
  'toast-inpainted':    'Inpaint applied!',
  'toast-paint-first':  'Paint first, then apply.',
  'toast-applied':      'Applied',
  'toast-empty-text':   'Empty text.',
  'toast-nothing':      'Nothing to do.',
  'toast-type-text':    'Type some text.',
  'toast-box-added':    'Box added.',
  'toast-box-removed':  'Box removed.',
  'toast-exported':     'Exported!',
  'status-ocr-empty':   'No text detected.',
  'status-ocr-done':    'blocks detected.',
  'status-translated':  'translated.',
  'toast-translated':   'translated.',
  'confirm-new':        'Start with a new image? Unsaved progress will be lost.',
  'tip-selection':      'Draw → angle bar + OCR button appear',
  'tip-lasso':          'Click=add point · Double-click=close · Right-click=close',
  'tip-textbox':        'Draw rectangle → box created',
  'tip-inpaint':        'Paint area → click 🪄 Inpaint',
  'tip-clone':          'Ctrl+click=source · Click=clone',
  'tip-stroke':         'Click and drag over text → auto OCR by line angle',
  'lbl-size-px':        'Size',
});
