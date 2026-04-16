/**
 * app.js — v6
 *
 * Novidades:
 *  1. Seleção rotacionável → OCR com imagem des-rotacionada
 *  2. Ferramenta Laço → OCR na bbox do laço
 *  3. Blocos manuais numerados (sem OCR obrigatório)
 *  4. Edição do texto OCR antes de traduzir (inline nos cards)
 *  5. PSM selecionável + idiomas expandidos
 *  6. 16 fontes manga + auto-sizing via OffscreenCanvas
 *  7. Auto layout melhorado no painel de edição da caixa
 *  8. Painel box-editor mostra texto OCR original separado
 */

import { runOCR, runOCRCanvas, runOCRRegion, terminateWorker } from './ocr.js';
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

const btnRunOCR        = $('btn-run-ocr');
const btnDetectBal     = $('btn-detect-balloons');
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

// ── Populate font select ──────────────────────────────────
if (boxFontFam)
  boxFontFam.innerHTML = FONTS.map(f=>`<option value="${f.name}">${f.label}</option>`).join('');

// ── STATE ─────────────────────────────────────────────────
const state = {
  image:         null,
  blocks:        [],
  balloons:      [],
  selectedBlock: null,
  _blockCounter: 0, // for sequential numbering of manual blocks
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
  if (selAngleInp) { selAngleInp.value = 0; }
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
  showLoading('OCR da seleção…', 10, deg ? `Ângulo: ${deg}°` : '');
  try {
    const croppedCanvas = editor.getRotatedCrop(_currentSelRect, deg);
    const psm = '6';
    const block = await runOCRCanvas(croppedCanvas, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct), psm);
    if (!block) { hideLoading(); toast('Sem texto detectado.', 'warning'); return; }
    block.bbox  = { ..._currentSelRect };
    block.angle = deg;
    state.blocks.push(block);
    state._blockCounter++;
    hideLoading();
    editor.drawOverlay(state.blocks, block.id, state.balloons);
    _renderBlockList();
    toast(`OCR: "${block.text.slice(0,35)}…"`, 'success');
    _hideSelToolbar();
    editor.clearSelection();
    btnClearSel?.classList.add('hidden');
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null);
  } catch(err) { hideLoading(); toast('Erro OCR: '+err.message,'error'); }
});

btnClearSel2?.addEventListener('click', () => {
  editor.clearSelection(); _hideSelToolbar();
  btnClearSel?.classList.add('hidden');
});

// ── LASSO OCR ────────────────────────────────────────────
async function _handleLassoOCR(data) {
  if (!data?.rect || data.rect.w < 10 || data.rect.h < 10) return;
  showLoading('OCR do laço…', 10);
  try {
    const block = await runOCRRegion(baseCanvas, data.rect, ocrLang.value,
      (pct, msg) => updateLoading(msg, pct));
    if (!block) { hideLoading(); toast('Sem texto.', 'warning'); return; }
    state.blocks.push(block);
    hideLoading();
    editor.drawOverlay(state.blocks, block.id, state.balloons);
    _renderBlockList();
    toast(`OCR laço: "${block.text.slice(0,30)}"`, 'success');
    editor.clearSelection();
    btnClearSel?.classList.add('hidden');
    toolBtns.forEach(b => b.classList.remove('active'));
    editor.setTool(null);
  } catch(err) { hideLoading(); toast('Erro: '+err.message,'error'); }
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
    img.onload=async()=>{await _initWithImage(img);toast('Imagem carregada!','success');};
    img.src=ev.target.result;
  };
  reader.readAsDataURL(file);
}

async function _initWithImage(img) {
  state.image=img; state.blocks=[]; state.balloons=[]; state._blockCounter=0;
  await terminateWorker();
  editor.loadImage(img);
  [selCanvas,ovrCanvas,prvCanvas].forEach(c=>{c.width=img.naturalWidth;c.height=img.naturalHeight;});
  inpCanvas.width=img.naturalWidth; inpCanvas.height=img.naturalHeight;
  textMgr.syncPreviewSize(img.naturalWidth,img.naturalHeight);
  stage.style.display=''; dropZone.style.display='none';
  syncZoomUI(editor.fitToStage(img.naturalWidth,img.naturalHeight));
  btnRunOCR.disabled=false; btnAddText.disabled=false;
  btnExport.disabled=false; btnDetectBal.disabled=false;
  setStep(2);
}

// ── PROJECT SAVE/LOAD ─────────────────────────────────────
btnSaveProj?.addEventListener('click',()=>{
  if(!state.image){toast('Nenhuma imagem','warning');return;}
  const proj=buildProject({baseCanvas,inpaintCanvas:inpCanvas,
    blocks:state.blocks,textBoxes:textMgr.getAllData(),
    balloons:state.balloons,meta:{lang:ocrLang.value,transLang:transLang.value}});
  autosave(proj); saveProjectFile(proj);
  toast('Projeto salvo!','success');
});
btnLoadProj?.addEventListener('click',()=>projInput.click());
$('link-load-project')?.addEventListener('click',(e)=>{e.preventDefault();projInput.click();});
projInput?.addEventListener('change',async()=>{if(projInput.files[0])await _doLoadProject(projInput.files[0]);});

async function _doLoadProject(file){
  showLoading('Carregando…',30);
  try{
    const proj=await loadProjectFile(file);
    const{image,blocks,textBoxes,balloons,meta}=await restoreProject(proj,{baseCanvas,inpaintCanvas:inpCanvas});
    await _initWithImage(image);
    state.blocks=blocks; state.balloons=balloons;
    if(meta.lang)      ocrLang.value  =meta.lang;
    if(meta.transLang) transLang.value=meta.transLang;
    textMgr.clear();
    for(const box of textBoxes) textMgr.add(box);
    editor.drawOverlay(state.blocks,null,state.balloons);
    _renderBlockList();
    hideLoading();
    toast(`Carregado — ${blocks.length} blocos, ${textBoxes.length} caixas`,'success');
    if(blocks.length){btnTranslate.disabled=false;setStep(4);}
  }catch(err){hideLoading();toast('Erro: '+err.message,'error');}
}

// ── OCR ───────────────────────────────────────────────────
btnRunOCR.addEventListener('click',async()=>{
  if(!state.image) return;
  btnRunOCR.disabled=true;
  showLoading('Iniciando OCR…',0,'1ª vez: aguarde o download dos dados');
  setStep(2);
  try{
    const blocks=await runOCR(baseCanvas,ocrLang.value,(pct,msg)=>updateLoading(msg,pct),ocrPsm?.value||'11');
    if(state.balloons.length)
      for(const b of blocks){
        const bal=findBalloonForBlock(b,state.balloons);
        if(bal){b.balloonId=`${bal.x}-${bal.y}`;b.balloonType=bal.type;}
      }
    state.blocks=blocks;
    hideLoading();setStep(3);
    if(!blocks.length){setStatus('ocr-status','Nenhum texto.','warning');toast('Sem texto.','warning');}
    else{setStatus('ocr-status',`✓ ${blocks.length} blocos.`,'success');toast(`${blocks.length} blocos!`,'success');btnTranslate.disabled=false;}
    editor.drawOverlay(blocks,null,state.balloons);
    _renderBlockList();
  }catch(err){
    hideLoading();setStatus('ocr-status',`Erro: ${err.message}`,'error');
    toast('Erro OCR: '+err.message,'error');
  }finally{btnRunOCR.disabled=false;}
});

// ── BALLOON DETECT ────────────────────────────────────────
btnDetectBal?.addEventListener('click',async()=>{
  if(!state.image) return;
  showLoading('Detectando balões…',20,'Aguardando OpenCV…');
  try{
    const ready=await waitForOpenCV(3000);
    updateLoading('Analisando…',50);
    const balloons=await detectBalloons(baseCanvas);
    state.balloons=balloons;
    for(const b of state.blocks){const bal=findBalloonForBlock(b,balloons);b.balloonId=bal?`${bal.x}-${bal.y}`:null;b.balloonType=bal?.type??null;}
    hideLoading();
    toast(`${balloons.length} balões (${ready?'OpenCV':'heurística'})`,'success');
    editor.drawOverlay(state.blocks,null,balloons);
    _renderBlockList();
  }catch(err){hideLoading();toast('Erro: '+err.message,'error');}
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
  editor.drawOverlay(state.blocks,id,state.balloons);
  _renderBlockList();
  btnTranslate.disabled=false;
  toast(`Bloco #${num} adicionado. Edite o texto no card.`,'info');
});

// ── TEXT-BOX TOOL (draw rect → create box) ────────────────
function _createTextBoxFromRect(rect){
  if(rect.w<20||rect.h<20) return;
  const fSize=Math.max(12,Math.min(36,Math.floor(rect.h*.4)));
  textMgr.add({x:rect.x,y:rect.y,w:rect.w,h:rect.h,text:'…',
    fontSize:fSize,fontFamily:'Bangers',color:'#000000',bgColor:'#ffffff',bgOpacity:.9,align:'center'});
  editor.clearSelection();
  toolBtns.forEach(b=>b.classList.remove('active'));
  editor.setTool(null);
  toast('Caixa criada. Edite no painel.','success');
}

// ── TRANSLATION ───────────────────────────────────────────
btnTranslate.addEventListener('click',async()=>{
  if(!state.blocks.length) return;
  btnTranslate.disabled=true;setStep(3);
  showLoading('Traduzindo…',0,`${state.blocks.length} blocos`);
  state.blocks.forEach(b=>{b.translating=true;}); _renderBlockList();
  let done=0;
  await translateBatch(
    state.blocks.map(b=>({id:b.id,text:b.text})),
    ocrLang.value,transLang.value,
    (id,res,err)=>{
      const b=state.blocks.find(x=>x.id===id);if(!b)return;
      b.translating=false;
      if(res){b.translation=res.text;b.translatedBy=res.service;}
      else b.translationError=err?.message;
      done++;updateBlockCard(b);
      updateLoading(`Traduzindo… ${done}/${state.blocks.length}`,(done/state.blocks.length)*100);
    });
  hideLoading();setStep(4);
  const ok=state.blocks.filter(b=>b.translation).length;
  setStatus('trans-status',`✓ ${ok}/${state.blocks.length} traduzidos.`,'success');
  toast(`${ok} traduzidos.`,'success');
  btnTranslate.disabled=false;_renderBlockList();
});

// ── BLOCK LIST ────────────────────────────────────────────
function _renderBlockList(){
  renderBlocks(state.blocks,{
    onSelect:         _selectBlock,
    onToggleVis:      (id)=>{const b=state.blocks.find(x=>x.id===id);if(b){b.visible=!b.visible;editor.drawOverlay(state.blocks,state.selectedBlock,state.balloons);_renderBlockList();}},
    onErase:          (id)=>{const b=state.blocks.find(x=>x.id===id);if(b){editor.fillRect(b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h,boxBg?.value||'#ffffff');toast('Apagado.','info');}},
    onInpaint:        _inpaintBlock,
    onReOCR:          _reOCRBlock,
    onDelete:         (id)=>{state.blocks=state.blocks.filter(b=>b.id!==id);textMgr.remove(id);editor.drawOverlay(state.blocks,state.selectedBlock,state.balloons);_renderBlockList();},
    onApply:          _applyTranslation,
    onOcrEdit:        (id,text)=>{const b=state.blocks.find(x=>x.id===id);if(b){b.text=text;}},
    onTranslationEdit:(id,text)=>{const b=state.blocks.find(x=>x.id===id);if(b)b.translation=text;},
  });
}

function _selectBlock(id){
  state.selectedBlock=id; highlightBlock(id);
  editor.drawOverlay(state.blocks,id,state.balloons);
  const b=state.blocks.find(x=>x.id===id);
  if(b) editor.panToCenter(b.bbox.x+b.bbox.w/2,b.bbox.y+b.bbox.h/2);
}

function _applyTranslation(id,text){
  const b=state.blocks.find(x=>x.id===id);
  if(!b||!text){toast('Texto vazio.','warning');return;}
  const font =pickFont(b);
  const fSize=pickFontSize(text,b.bbox,font);
  const bg   =boxBg?.value||'#ffffff';
  const bgOp =(boxOpacity?.value??90)/100;
  const col  =boxColor?.value||'#000000';
  const analysis=textMgr.analyzeRegion(baseCanvas,b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h);
  b.placementWarning=analysis.score>0.4;
  const balloon=state.balloons.find(bl=>b.bbox.x>=bl.x&&b.bbox.x<=bl.x+bl.w&&b.bbox.y>=bl.y&&b.bbox.y<=bl.y+bl.h);
  const targetBox=balloon??b.bbox;
  editor.fillRect(b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h,bg);
  const ty=analysis.suggestion?.y??targetBox.y+2;
  textMgr.add({id,text,x:targetBox.x+2,y:ty,w:Math.max(targetBox.w-4,60),h:targetBox.h,
    fontSize:fSize,fontFamily:font,color:col,bgColor:bg,bgOpacity:bgOp,align:'center'});
  b.applied=true;
  editor.drawOverlay(state.blocks,state.selectedBlock,state.balloons);
  _renderBlockList();
  toast(b.placementWarning?'Aplicado ⚠ cobre arte':`Aplicado (${font}, ${fSize}px)`,
        b.placementWarning?'warning':'success');
}

// ── INPAINT ───────────────────────────────────────────────
async function _inpaintBlock(id){
  const b=state.blocks.find(x=>x.id===id);if(!b)return;
  showLoading('Inpainting…',30);
  try{
    await new Promise(r=>setTimeout(r,0));
    inpaintRect(baseCanvas,b.bbox.x,b.bbox.y,b.bbox.w,b.bbox.h,{method:b.bbox.w*b.bbox.h>4000?'patch':'telea'});
    hideLoading();toast('Inpaint aplicado!','success');
  }catch(err){hideLoading();toast('Erro: '+err.message,'error');}
}

btnApplyInpSel?.addEventListener('click',async()=>{
  showLoading('Inpainting da máscara…',20);
  try{
    await new Promise(r=>setTimeout(r,0));
    const mask=editor.getInpaintMask();
    if(!mask.some(v=>v)){hideLoading();toast('Pinte antes de aplicar.','warning');return;}
    inpaintMask(baseCanvas,mask,{feather:4});
    editor.clearInpaintLayer();
    hideLoading();btnApplyInpSel.classList.add('hidden');
    toast('Inpaint aplicado!','success');
  }catch(err){hideLoading();toast('Erro: '+err.message,'error');}
});

btnInpaintBox?.addEventListener('click',()=>{
  if(!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId);if(!box)return;
  const d=box.data;
  inpaintRect(baseCanvas,d.x,d.y,d.w,d.h,{method:'auto'});
  toast('Inpaint na caixa.','success');
});

// ── RE-OCR ────────────────────────────────────────────────
async function _reOCRBlock(id){
  const block=state.blocks.find(b=>b.id===id);if(!block)return;
  showLoading('Re-OCR…',10);
  try{
    const nb=await runOCRRegion(baseCanvas,block.bbox,ocrLang.value,(pct,msg)=>updateLoading(msg,pct));
    if(nb){block.text=nb.text;block.confidence=nb.confidence;block.translation='';}
    hideLoading();editor.drawOverlay(state.blocks,id,state.balloons);_renderBlockList();
    toast(nb?`Re-OCR: "${nb.text.slice(0,30)}"`: 'Sem texto.',nb?'success':'warning');
  }catch(err){hideLoading();toast('Erro: '+err.message,'error');}
}

// ── OCR on selected box ───────────────────────────────────
btnOcrBox?.addEventListener('click',async()=>{
  if(!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId);if(!box)return;
  const d=box.data;
  showLoading('OCR…',10);
  try{
    const block=await runOCRRegion(baseCanvas,{x:d.x,y:d.y,w:d.w,h:d.h},ocrLang.value,(pct,msg)=>updateLoading(msg,pct));
    if(block){
      textMgr.update(textMgr.selectedId,{text:block.text});
      if(boxText) boxText.value=block.text;
      if(boxOcrText) boxOcrText.value=block.text;
    }
    hideLoading();toast(block?`OCR: ${block.text.slice(0,30)}`:'Sem texto.',block?'success':'warning');
  }catch(err){hideLoading();toast('Erro: '+err.message,'error');}
});

// Copy OCR → translation textarea
btnCopyOcr?.addEventListener('click',()=>{
  if(boxOcrText&&boxText) boxText.value=boxOcrText.value;
  textMgr.updateSelected({text:boxText?.value||''});
});

// ── AUTO LAYOUT ───────────────────────────────────────────
btnAutoLayout?.addEventListener('click',()=>{
  if(!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId);if(!box)return;
  const d=box.data;
  const font =pickFont({text:d.text,bbox:{w:d.w,h:d.h}});
  const fSize=pickFontSize(d.text,{w:d.w,h:d.h},font);
  textMgr.update(textMgr.selectedId,{fontFamily:font,fontSize:fSize});
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
      btn.classList.add('active');editor.setTool(tool);
      _renderToolOpts(tool);
      toast(btn.textContent.trim(),'info',1400);
    }else _renderToolOpts(null);
  });
});

function _renderToolOpts(tool){
  const opts=$('tool-options');if(!opts)return;
  opts.innerHTML='';
  if(!tool) return;
  if(tool==='selection')  {opts.innerHTML='<p class="tip-text">Desenhe → aparece barra com ângulo + botão OCR</p>';return;}
  if(tool==='lasso')      {opts.innerHTML='<p class="tip-text">Click=adiciona ponto · Duplo-click=fecha · Clique-direito=fecha</p>';return;}
  if(tool==='text-box')   {opts.innerHTML='<p class="tip-text">Desenhe o retângulo → caixa criada</p>';return;}
  if(tool==='inpaint')    {opts.innerHTML='<p class="tip-text">Pinte → clique "🪄 Inpaint" para aplicar</p>';return;}
  if(tool==='clone')      {opts.innerHTML='<p class="tip-text">Ctrl+click=fonte · Click=clona</p>';editor.toast=toast;}

  const row=document.createElement('div');row.className='tool-group';
  row.innerHTML=`<label class="tool-label">Tamanho: <span id="t-sv">20</span>px</label>
    <input type="range" id="t-size" min="3" max="120" value="20" class="tool-range"/>`;
  opts.insertBefore(row,opts.firstChild);

  if(tool==='brush'||tool==='fill'||tool==='eraser'){
    const cr=document.createElement('div');cr.className='tool-group';
    cr.innerHTML=`<label class="tool-label">Cor</label><input type="color" id="t-color" value="${tool==='eraser'?'#ffffff':'#000000'}" class="tool-color"/>`;
    opts.appendChild(cr);
    opts.querySelector('#t-color')?.addEventListener('input',e=>editor.setToolColor(e.target.value));
  }
  opts.querySelector('#t-size')?.addEventListener('input',e=>{
    editor.setToolSize(+e.target.value);
    const sv=opts.querySelector('#t-sv');if(sv)sv.textContent=e.target.value;
  });
}

btnClearSel?.addEventListener('click',()=>{
  editor.clearSelection();_hideSelToolbar();
  btnClearSel.classList.add('hidden');btnApplyInpSel?.classList.add('hidden');
});

// ── UNDO/REDO ─────────────────────────────────────────────
btnUndo?.addEventListener('click',()=>{if(!editor.undo())toast('Nada.','warning');});
btnRedo?.addEventListener('click',()=>{if(!editor.redo())toast('Nada.','warning');});

// ── TEXTO MANUAL ─────────────────────────────────────────
btnAddText?.addEventListener('click',()=>{
  const text=newTextIn?.value.trim();if(!text){toast('Digite o texto.','warning');return;}
  const fam=boxFontFam?.value||'Bangers';
  const fsz=boxFontAuto?.checked
    ? pickFontSize(text,{w:Math.floor(baseCanvas.width*.3),h:60},fam)
    : +boxFontSize?.value||18;
  textMgr.add({text,
    x:Math.floor(baseCanvas.width*.05),y:Math.floor(baseCanvas.height*.05),
    w:Math.floor(baseCanvas.width*.3),
    fontSize:fsz,fontFamily:fam,
    color:boxColor?.value||'#000000',bgColor:boxBg?.value||'#ffffff',
    bgOpacity:(boxOpacity?.value??90)/100,
    align:document.querySelector('.align-btn.active')?.dataset.align||'center',
  });
  if(newTextIn) newTextIn.value='';
  toast('Adicionado.','success');
});

// ── BOX EDITOR LIVE UPDATE ────────────────────────────────
function _populateBoxEditor(data){
  if(boxOcrText) { // find block text for the box id
    const block=state.blocks.find(b=>b.id===data.id);
    boxOcrText.value=block?.text||'';
  }
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
boxText?.addEventListener('input',()=>{
  clearTimeout(_td);_td=setTimeout(()=>textMgr.updateSelected({text:boxText.value}),60);
  // If auto-size enabled, recalc font size
  if(boxFontAuto?.checked && textMgr.selectedId){
    const box=textMgr.boxes.get(textMgr.selectedId);
    if(box){
      const fSize=pickFontSize(boxText.value,{w:box.data.w,h:box.data.h},box.data.fontFamily);
      textMgr.updateSelected({fontSize:fSize});
      if(boxFontSize) boxFontSize.value=fSize;
    }
  }
});

boxFontFam?.addEventListener('change', ()=>{ textMgr.updateSelected({fontFamily:boxFontFam.value}); _recalcAutoSize(); });
boxFontSize?.addEventListener('input', ()=>{ if(!boxFontAuto?.checked) textMgr.updateSelected({fontSize:+boxFontSize.value||18}); });
boxColor?.addEventListener('input',    ()=>textMgr.updateSelected({color:boxColor.value}));
boxBg?.addEventListener('input',       ()=>textMgr.updateSelected({bgColor:boxBg.value}));
boxOpacity?.addEventListener('input',  ()=>{if(boxOpacityV)boxOpacityV.textContent=boxOpacity.value;textMgr.updateSelected({bgOpacity:boxOpacity.value/100});});
boxRotation?.addEventListener('input', ()=>{if(boxRotationV)boxRotationV.textContent=boxRotation.value;textMgr.updateSelected({rotation:+boxRotation.value});});
alignBtns.forEach(btn=>btn.addEventListener('click',()=>{alignBtns.forEach(b=>b.classList.remove('active'));btn.classList.add('active');textMgr.updateSelected({align:btn.dataset.align});}));
btnDeleteBox?.addEventListener('click',()=>{if(textMgr.selectedId){textMgr.remove(textMgr.selectedId);toast('Removida.','info');}});

function _recalcAutoSize(){
  if(!boxFontAuto?.checked||!textMgr.selectedId) return;
  const box=textMgr.boxes.get(textMgr.selectedId);if(!box)return;
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
  showLoading('Exportando…',70);
  try{
    const url=editor.exportImage(textMgr.getAllData());
    Object.assign(document.createElement('a'),{download:`manga-${Date.now()}.png`,href:url}).click();
    setStep(5);hideLoading();toast('Exportado!','success');
  }catch(e){hideLoading();toast('Erro: '+e.message,'error');}
});

// ── NEW IMAGE ────────────────────────────────────────────
btnNew?.addEventListener('click',async()=>{
  if(!confirm('Iniciar com nova imagem? O progresso será perdido.')) return;
  await terminateWorker();
  state.image=null;state.blocks=[];state.balloons=[];
  editor.clearOverlay();textMgr.clear();
  stage.style.display='none';dropZone.style.display='';
  btnRunOCR.disabled=true;btnTranslate.disabled=true;
  btnAddText.disabled=true;btnDetectBal.disabled=true;
  fileInput.value='';
  clearStatus('ocr-status');clearStatus('trans-status');
  _renderBlockList();setStep(1);
  if(boxEditor)boxEditor.style.display='none';
  _hideSelToolbar();
});

// ── KEYBOARD ─────────────────────────────────────────────
document.addEventListener('keydown',(e)=>{
  const tag=document.activeElement?.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT') return;
  const map={b:'brush',e:'eraser',u:'blur',f:'fill',c:'clone',s:'selection',l:'lasso',i:'inpaint',t:'text-box'};
  if(map[e.key]){document.querySelector(`.tool-btn[data-tool="${map[e.key]}"]`)?.click();return;}
  if(e.ctrlKey&&e.key==='z'){e.preventDefault();btnUndo?.click();}
  if(e.ctrlKey&&e.key==='y'){e.preventDefault();btnRedo?.click();}
  if(e.ctrlKey&&e.key==='s'){e.preventDefault();btnSaveProj?.click();}
  if(e.key==='0')btnFit?.click();
  if(e.key==='1')btnZoomReset?.click();
  if((e.key==='+'||e.key==='=')&&!e.ctrlKey){editor.setScale(editor.scale*1.15);syncZoomUI(editor.scale);}
  if(e.key==='-'&&!e.ctrlKey){editor.setScale(editor.scale/1.15);syncZoomUI(editor.scale);}
  if(e.key==='Escape'){
    toolBtns.forEach(b=>b.classList.remove('active'));
    editor.setTool(null);editor.clearSelection();
    textMgr.deselect();_renderToolOpts(null);_hideSelToolbar();
  }
  if((e.key==='Delete'||e.key==='Backspace')&&textMgr.selectedId){
    textMgr.remove(textMgr.selectedId);toast('Removida.','info');
  }
});

// ── INIT ────────────────────────────────────────────────
if(boxEditor) boxEditor.style.display='none';
_renderBlockList();setStep(1);

waitForOpenCV(12000).then(ok=>
  console.log('[v6] OpenCV:', ok ? 'pronto' : 'fallback JS'));

toast('MangaEasyTranslator v6 pronto!','info',3500);
