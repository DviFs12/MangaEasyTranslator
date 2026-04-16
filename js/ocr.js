/**
 * ocr.js — v6
 * Worker singleton reutilizado. Suporta PSM configurável.
 * runOCRCanvas(canvas, lang, psm) — novo: aceita canvas pré-cropped (para seleção rotacionada).
 */

let _workerCache = null;

async function getWorker(T, lang, onLog) {
  if (_workerCache?.lang === lang) return _workerCache.worker;
  if (_workerCache) { try{await _workerCache.worker.terminate();}catch(_){} _workerCache=null; }
  const worker = await T.createWorker({ logger: onLog });
  await worker.loadLanguage(lang);
  await worker.initialize(lang);
  _workerCache = { worker, lang };
  return worker;
}

export async function terminateWorker() {
  if (_workerCache) { try{await _workerCache.worker.terminate();}catch(_){} _workerCache=null; }
}

function waitForTesseract(ms=15000) {
  return new Promise((resolve,reject)=>{
    if(window.Tesseract) return resolve(window.Tesseract);
    const t0=Date.now();
    const id=setInterval(()=>{
      if(window.Tesseract){clearInterval(id);resolve(window.Tesseract);}
      else if(Date.now()-t0>ms){clearInterval(id);reject(new Error('Tesseract não carregou.'));}
    },150);
  });
}

// ── Full page OCR ─────────────────────────────────────────
export async function runOCR(canvas, lang='jpn', onProgress=()=>{}, psm='11') {
  const T = await waitForTesseract();
  onProgress(5,'Iniciando Tesseract…');
  const worker = await getWorker(T, lang, (m)=>{
    if(m.status==='loading tesseract core')      onProgress(8,'Carregando núcleo…');
    else if(m.status==='loading language traineddata') onProgress(14,`Baixando: ${lang}…`);
    else if(m.status==='initializing tesseract') onProgress(17,'Inicializando…');
    else if(m.status==='initializing api')       onProgress(19,'Pronto…');
    else if(m.status==='recognizing text')       onProgress(22+Math.round(m.progress*68),'Reconhecendo…');
  });
  await worker.setParameters({ tessedit_pageseg_mode: psm });
  onProgress(22,'Analisando imagem…');
  const src = canvas.toDataURL('image/png');
  const { data } = await worker.recognize(src);
  onProgress(92,'Extraindo blocos…');
  const blocks = extractAndCluster(data, canvas.width, canvas.height);
  onProgress(100,`Pronto — ${blocks.length} blocos`);
  return blocks;
}

// ── Region OCR (accepts pre-cropped canvas, supports rotation) ──
export async function runOCRCanvas(croppedCanvas, lang='jpn', onProgress=()=>{}, psm='6') {
  const T = await waitForTesseract();
  onProgress(10,'OCR da região…');
  const worker = await getWorker(T, lang, (m)=>{
    if(m.status==='recognizing text')
      onProgress(20+Math.round(m.progress*70),'Reconhecendo…');
  });
  await worker.setParameters({ tessedit_pageseg_mode: psm });

  // toDataURL only on the small cropped canvas (much smaller than full page)
  const src = croppedCanvas.toDataURL('image/png');
  const { data } = await worker.recognize(src);
  onProgress(95,'Processando…');

  const text = _clean((data.text||'').replace(/\n+/g,' '));
  if (!text) { onProgress(100,'Sem texto'); return null; }

  return {
    id:`block-manual-${Date.now()}`,
    text, confidence:Math.round(data.confidence||0),
    translation:'', visible:true, applied:false, manual:true,
  };
}

// ── Region OCR from rect (convenience) ─────────────────────
export async function runOCRRegion(canvas, rect, lang='jpn', onProgress=()=>{}, psm='6') {
  const tmp = document.createElement('canvas');
  tmp.width  = Math.ceil(rect.w);
  tmp.height = Math.ceil(rect.h);
  tmp.getContext('2d').drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const block = await runOCRCanvas(tmp, lang, onProgress, psm);
  if (block) {
    block.bbox = { x:rect.x, y:rect.y, w:rect.w, h:rect.h };
  }
  return block;
}

// ── EXTRACTION + DBSCAN CLUSTERING ─────────────────────────
function extractAndCluster(data, imgW, imgH) {
  const words = [];
  for (const tb of (data.blocks||[])) {
    for (const para of (tb.paragraphs||[])) {
      for (const line of (para.lines||[])) {
        for (const word of (line.words||[])) {
          const t=_clean(word.text);
          if(!t||word.confidence<8) continue;
          const bb=word.bbox;
          if(!bb||bb.x1<=bb.x0||bb.y1<=bb.y0) continue;
          words.push({text:t,x0:bb.x0,y0:bb.y0,x1:bb.x1,y1:bb.y1,conf:word.confidence,lineH:bb.y1-bb.y0});
        }
      }
    }
  }
  if(!words.length) return _fallback(data);

  const HGAP=60, VGAP=24, SIZE_R=1.8;
  const used=new Uint8Array(words.length);
  const clusters=[];

  for(let i=0;i<words.length;i++){
    if(used[i]) continue;
    const group=[i]; used[i]=1;
    const queue=[i];
    while(queue.length){
      const ci=queue.shift(), a=words[ci];
      for(let j=0;j<words.length;j++){
        if(used[j]) continue;
        const b=words[j];
        const yOvlp=Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0);
        const hGap=Math.max(b.x0-a.x1,a.x0-b.x1);
        const sameLine=yOvlp>0&&hGap>=0&&hGap<=HGAP;
        const sizeMatch=Math.max(a.lineH,b.lineH)/Math.max(1,Math.min(a.lineH,b.lineH))<SIZE_R;
        const xOvlp=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0);
        const vGap=Math.max(b.y0-a.y1,a.y0-b.y1);
        const adjLine=sizeMatch&&xOvlp>-10&&vGap>=0&&vGap<=VGAP;
        if(sameLine||adjLine){used[j]=1;group.push(j);queue.push(j);}
      }
    }
    const gs=group.map(i=>words[i]);
    const xs=gs.flatMap(w=>[w.x0,w.x1]),ys=gs.flatMap(w=>[w.y0,w.y1]);
    const conf=gs.reduce((s,w)=>s+w.conf,0)/gs.length;
    gs.sort((a,b)=>Math.abs(a.y0-b.y0)>8?a.y0-b.y0:a.x0-b.x0);
    // Group into lines
    const lineGroups=[]; let cur=[gs[0]];
    for(let k=1;k<gs.length;k++){
      const prev=cur[cur.length-1];
      (Math.min(prev.y1,gs[k].y1)-Math.max(prev.y0,gs[k].y0)>0||Math.abs(gs[k].y0-prev.y0)<prev.lineH*.5)?cur.push(gs[k]):(lineGroups.push(cur),cur=[gs[k]]);
    }
    lineGroups.push(cur);
    const text=lineGroups.map(l=>l.map(w=>w.text).join(' ')).join('\n');
    clusters.push({
      id:`block-${clusters.length}`,
      text:_clean(text),
      bbox:{x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)},
      confidence:Math.round(conf),
      translation:'',visible:true,applied:false,
    });
  }
  return clusters;
}

function _fallback(data){
  const items=[];let id=0;
  const tryP=(p)=>{
    const text=_clean(p.text);
    if(!text||p.confidence<8) return;
    const bb=p.bbox;
    if(!bb||bb.x1<=bb.x0||bb.y1<=bb.y0) return;
    items.push({id:`block-${id++}`,text,confidence:Math.round(p.confidence),
      bbox:{x:bb.x0,y:bb.y0,w:bb.x1-bb.x0,h:bb.y1-bb.y0},
      translation:'',visible:true,applied:false});
  };
  if(data.blocks?.length) for(const b of data.blocks) for(const p of(b.paragraphs||[]))tryP(p);
  else if(data.lines?.length) data.lines.forEach(tryP);
  return items;
}

function _clean(t){return(t||'').replace(/\s+/g,' ').trim();}
