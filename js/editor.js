/**
 * editor.js — v8
 *
 * Novidades vs v7:
 *  1. Ferramenta "stroke" (Linha OCR):
 *     Usuário desenha uma linha sobre o texto. O sistema detecta o ângulo
 *     da linha, expande uma bbox perpendicular, extrai o crop des-rotacionado
 *     e dispara OCR. onSelectionChange recebe { rect, angle, points }, tool='stroke'.
 *
 *  2. getLassoMaskedCrop(points) → canvas:
 *     Novo método que aplica máscara real do polígono do laço antes de enviar
 *     para OCR. Pixels fora do polígono ficam brancos (fundo Tesseract).
 *     Substitui o antigo runOCRRegion simples que usava apenas a bbox.
 *
 *  3. getStrokeCrop(p1, p2, thickness) → { canvas, angle, rect }:
 *     Extrai uma faixa ao redor da linha desenhada, des-rotacionada para
 *     que o Tesseract receba texto horizontal.
 */

export class CanvasEditor {
  constructor({ stage, world, base, inpaint, selection, overlay }) {
    this.stage     = stage;
    this.world     = world;
    this.base      = base;
    this.inpaint   = inpaint;
    this.selection = selection;
    this.overlay   = overlay;

    this.ctx  = base.getContext('2d', { willReadFrequently: true });
    this.iCtx = inpaint.getContext('2d', { willReadFrequently: true });
    this.sCtx = selection.getContext('2d');
    this.oCtx = overlay.getContext('2d');

    this.scale = 1; this.tx = 0; this.ty = 0;
    this._rafId = null; this._transformDirty = false;

    this._panning = false; this._panStart = {x:0,y:0}; this._panOrigin = {x:0,y:0};

    this.activeTool = null;
    this.toolSize   = 20;
    this.toolColor  = '#ffffff';

    this._cloneSource = null; this._cloneSet = false; this._cloneOffset = null;

    // Rect selection
    this._selStart = null;
    this._selRect  = null;
    this._selAngle = 0;

    // Lasso
    this._lassoPoints = [];
    this._lassoActive = false;

    // Stroke tool (line OCR)
    this._strokeStart  = null;
    this._strokeEnd    = null;
    this._strokeActive = false;

    this._drawing = false; this._lastPt = null;

    this._undoStack = []; this._redoStack = [];
    this.MAX_HISTORY = 30;
    this._pendingCmd = null;

    this.layerVisible = { base:true, inpaint:true, text:true, overlay:true };

    this._blurOff = document.createElement('canvas');

    this.onToolChange      = null;
    this.onSelectionChange = null;
    this._zoomCb           = null;

    this._bindEvents();
  }

  // ═══════════════════════ IMAGE ═══════════════════════════
  loadImage(img) {
    const w=img.naturalWidth, h=img.naturalHeight;
    [this.base,this.inpaint,this.selection,this.overlay].forEach(c=>{c.width=w;c.height=h;});
    this.ctx.drawImage(img,0,0);
    this._undoStack=[]; this._redoStack=[]; this._pendingCmd=null;
    this._blurOff.width=200; this._blurOff.height=200;
    this._selAngle=0;
  }

  // ═══════════════════════ TRANSFORM ═══════════════════════
  _sched() {
    if (this._rafId) return;
    this._rafId=requestAnimationFrame(()=>{
      this._rafId=null;
      if (this._transformDirty) {
        this.world.style.transform=`translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
        this._transformDirty=false;
      }
    });
  }
  _setT(tx,ty,s){this.tx=tx;this.ty=ty;this.scale=s;this._transformDirty=true;this._sched();}
  setScale(s,cx,cy){
    const r=this.stage.getBoundingClientRect();
    cx=cx??r.width/2; cy=cy??r.height/2;
    const wx=(cx-this.tx)/this.scale, wy=(cy-this.ty)/this.scale;
    s=Math.max(0.08,Math.min(5,s));
    this._setT(cx-wx*s,cy-wy*s,s); return s;
  }
  fitToStage(nw,nh){
    const r=this.stage.getBoundingClientRect();
    const s=Math.min((r.width-40)/nw,(r.height-40)/nh,1);
    this._setT((r.width-nw*s)/2,(r.height-nh*s)/2,s); return s;
  }
  centerInStage(nw,nh){
    const r=this.stage.getBoundingClientRect();
    this._setT((r.width-nw*this.scale)/2,(r.height-nh*this.scale)/2,this.scale);
  }
  panToCenter(cx,cy){
    const r=this.stage.getBoundingClientRect();
    this._setT(r.width/2-cx*this.scale,r.height/2-cy*this.scale,this.scale);
  }
  onZoomChange(cb){this._zoomCb=cb;}

  // ═══════════════════════ TOOLS ═══════════════════════════
  setTool(name){
    this.activeTool=name;
    this.stage.className=this.stage.className.replace(/\btool-\S+/g,'').trim();
    if(name) this.stage.classList.add(`tool-${name}`);
    this._cloneSet=false;
    if(this.onToolChange) this.onToolChange(name);
  }
  setToolSize(s){this.toolSize=s;}
  setToolColor(c){this.toolColor=c;}

  // ═══════════════════════ SELECTION ANGLE ════════════════
  setSelAngle(deg) {
    this._selAngle = deg;
    if (this._selRect) this._drawSelOverlay();
  }

  // ═══════════════════════ LAYERS ═════════════════════════
  setLayerVisible(layer,visible){
    this.layerVisible[layer]=visible;
    if(layer==='base')    this.base.style.opacity   =visible?'':'0';
    if(layer==='inpaint') this.inpaint.style.opacity=visible?'':'0';
    if(layer==='overlay') this.overlay.style.opacity=visible?'':'0';
  }

  // ═══════════════════════ COORD ══════════════════════════
  _toCanvas(cx,cy){
    const r=this.stage.getBoundingClientRect();
    return{x:(cx-r.left-this.tx)/this.scale, y:(cy-r.top-this.ty)/this.scale};
  }

  // ═══════════════════════ EVENTS ═════════════════════════
  _bindEvents(){
    const s=this.stage;

    s.addEventListener('wheel',(e)=>{
      e.preventDefault();
      const r=s.getBoundingClientRect(), f=e.deltaY<0?1.12:0.89;
      const ns=this.setScale(this.scale*f,e.clientX-r.left,e.clientY-r.top);
      if(this._zoomCb) this._zoomCb(ns);
    },{passive:false});

    s.addEventListener('mousedown',(e)=>{
      if(e.button===1||e.button===2||(e.button===0&&e.altKey)){e.preventDefault();this._startPan(e.clientX,e.clientY);return;}
      if(e.button!==0) return;
      e.preventDefault();
      const pt=this._toCanvas(e.clientX,e.clientY);

      if(!this.activeTool){this._startPan(e.clientX,e.clientY);return;}

      if(this.activeTool==='selection'||this.activeTool==='text-box'){
        this._selStart=pt; this._selRect=null; this._drawing=true; return;
      }

      if(this.activeTool==='lasso'){
        if(!this._lassoActive){
          this._lassoActive=true;
          this._lassoPoints=[pt];
        } else {
          this._lassoPoints.push(pt);
          this._drawSelOverlay();
        }
        this._drawing=true; return;
      }

      // ── Stroke tool: mousedown starts line, mouseup fires OCR ──────────
      if(this.activeTool==='stroke'){
        this._strokeStart=pt; this._strokeEnd=pt;
        this._strokeActive=true; this._drawing=true; return;
      }

      if(this.activeTool==='clone'){
        if(!this._cloneSet||e.ctrlKey){
          this._cloneSource=pt; this._cloneSet=true; this._cloneOffset=null;
          this.toast?.('Clone: fonte definida. Click=aplicar','info'); return;
        }
        if(!this._cloneOffset) this._cloneOffset={dx:pt.x-this._cloneSource.x,dy:pt.y-this._cloneSource.y};
      }

      this._drawing=true; this._lastPt=pt;
      if(this.activeTool==='fill'){this._commitFill(pt);this._drawing=false;return;}
      this._openCmd(pt);
      this._doStroke(pt,pt);
    });

    document.addEventListener('mousemove',(e)=>{
      if(this._panning){
        this._setT(this._panOrigin.x+e.clientX-this._panStart.x,
                   this._panOrigin.y+e.clientY-this._panStart.y,this.scale);
        if(this._zoomCb) this._zoomCb(this.scale); return;
      }
      if(!this._drawing) return;
      const pt=this._toCanvas(e.clientX,e.clientY);

      if((this.activeTool==='selection'||this.activeTool==='text-box')&&this._selStart){
        this._selRect=_normRect(this._selStart,pt);
        this._drawSelOverlay(); return;
      }

      if(this.activeTool==='lasso'&&this._lassoActive){
        this._drawSelOverlay(pt); return;
      }

      if(this.activeTool==='stroke'&&this._strokeActive){
        this._strokeEnd=pt;
        this._drawSelOverlay(); return;
      }

      this._doStroke(this._lastPt,pt); this._lastPt=pt;
    });

    document.addEventListener('mouseup',(e)=>{
      if(this._panning){this._panning=false;s.classList.remove('is-panning');}
      if(this._drawing){
        this._drawing=false;

        if((this.activeTool==='selection'||this.activeTool==='text-box')&&this._selRect){
          if(this.onSelectionChange) this.onSelectionChange(
            {rect:this._selRect, angle:this._selAngle}, this.activeTool);
        }

        // ── Stroke: commit on mouseup ─────────────────────────────────
        if(this.activeTool==='stroke'&&this._strokeActive&&this._strokeStart&&this._strokeEnd){
          const dx = this._strokeEnd.x - this._strokeStart.x;
          const dy = this._strokeEnd.y - this._strokeStart.y;
          const len = Math.hypot(dx, dy);
          if (len > 8) {
            this._strokeActive = false;
            const { rect, angle } = _strokeBbox(this._strokeStart, this._strokeEnd, 60);
            if (this.onSelectionChange) this.onSelectionChange(
              { rect, angle, points: [this._strokeStart, this._strokeEnd] }, 'stroke');
          } else {
            this._strokeStart = null; this._strokeEnd = null; this._strokeActive = false;
            this.sCtx.clearRect(0, 0, this.selection.width, this.selection.height);
          }
        }

        this._closeCmd();
      }
    });

    // Double-click or right-click closes lasso
    s.addEventListener('dblclick',(e)=>{
      if(this.activeTool==='lasso'&&this._lassoActive&&this._lassoPoints.length>2){
        this._closeLasso();
      }
    });

    s.addEventListener('contextmenu',(e)=>{
      e.preventDefault();
      if(this.activeTool==='lasso'&&this._lassoActive&&this._lassoPoints.length>2){
        this._closeLasso();
      }
    });

    let lp=0;
    s.addEventListener('touchstart',(e)=>{
      e.preventDefault();
      if(e.touches.length===1){
        const t=e.touches[0], pt=this._toCanvas(t.clientX,t.clientY);
        if(!this.activeTool){this._startPan(t.clientX,t.clientY);return;}
        this._drawing=true; this._lastPt=pt;
        this._openCmd(pt); this._doStroke(pt,pt);
      } else if(e.touches.length===2){
        lp=_pd(e.touches);
        this._startPan((e.touches[0].clientX+e.touches[1].clientX)/2,(e.touches[0].clientY+e.touches[1].clientY)/2);
      }
    },{passive:false});

    s.addEventListener('touchmove',(e)=>{
      e.preventDefault();
      if(e.touches.length===1){
        const t=e.touches[0];
        if(this._panning){this._setT(this._panOrigin.x+t.clientX-this._panStart.x,this._panOrigin.y+t.clientY-this._panStart.y,this.scale);return;}
        if(this._drawing){const pt=this._toCanvas(t.clientX,t.clientY);this._doStroke(this._lastPt,pt);this._lastPt=pt;}
      } else if(e.touches.length===2){
        const d=_pd(e.touches);
        if(lp){const cx=(e.touches[0].clientX+e.touches[1].clientX)/2,cy=(e.touches[0].clientY+e.touches[1].clientY)/2,r=s.getBoundingClientRect();const ns=this.setScale(this.scale*(d/lp),cx-r.left,cy-r.top);if(this._zoomCb)this._zoomCb(ns);}
        lp=d;
      }
    },{passive:false});

    s.addEventListener('touchend',()=>{this._panning=false;this._drawing=false;s.classList.remove('is-panning');lp=0;this._closeCmd();});
  }

  _closeLasso() {
    this._lassoActive = false;
    const bbox = _lassoBbox(this._lassoPoints);
    if (this.onSelectionChange) this.onSelectionChange(
      { rect: bbox, points: [...this._lassoPoints], angle: 0 }, 'lasso');
  }

  _startPan(x,y){this._panning=true;this._panStart={x,y};this._panOrigin={x:this.tx,y:this.ty};this.stage.classList.add('is-panning');}

  // ═══════════════════════ DRAWING ════════════════════════
  _doStroke(from,to){
    const ctx=this.activeTool==='inpaint'?this.iCtx:this.ctx;
    const r=this.toolSize/2, tool=this.activeTool;

    if(tool==='brush'||tool==='eraser'){
      ctx.save();
      ctx.strokeStyle=tool==='brush'?this.toolColor:'#ffffff';
      ctx.lineWidth=this.toolSize;ctx.lineCap='round';ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
      ctx.restore();

    }else if(tool==='blur'){
      const bw=Math.ceil(r*4),bh=Math.ceil(r*4);
      const bx=Math.max(0,Math.floor(to.x-r*2)),by=Math.max(0,Math.floor(to.y-r*2));
      const aw=Math.min(bw,this.base.width-bx),ah=Math.min(bh,this.base.height-by);
      if(aw>0&&ah>0){
        if(this._blurOff.width<aw)this._blurOff.width=aw;
        if(this._blurOff.height<ah)this._blurOff.height=ah;
        const bCtx=this._blurOff.getContext('2d',{willReadFrequently:true});
        bCtx.drawImage(this.base,bx,by,aw,ah,0,0,aw,ah);
        ctx.save();ctx.filter=`blur(${Math.max(2,r*0.55)}px)`;
        ctx.beginPath();ctx.arc(to.x,to.y,r,0,Math.PI*2);ctx.clip();
        ctx.drawImage(this._blurOff,0,0,aw,ah,bx,by,aw,ah);
        ctx.restore();
      }

    }else if(tool==='inpaint'){
      ctx.save();
      ctx.fillStyle='rgba(230,57,70,0.35)';
      ctx.strokeStyle='rgba(230,57,70,0.35)';
      ctx.lineWidth=this.toolSize;ctx.lineCap='round';
      ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.lineTo(to.x,to.y);ctx.stroke();
      ctx.restore();

    }else if(tool==='clone'&&this._cloneOffset){
      const sx=to.x-this._cloneOffset.dx,sy=to.y-this._cloneOffset.dy;
      ctx.save();ctx.beginPath();ctx.arc(to.x,to.y,r,0,Math.PI*2);ctx.clip();
      ctx.drawImage(this.base,sx-r,sy-r,r*2,r*2,to.x-r,to.y-r,r*2,r*2);
      ctx.restore();
    }
  }

  _commitFill(pt){
    const x0=Math.round(pt.x),y0=Math.round(pt.y);
    const W=this.base.width,H=this.base.height;
    if(x0<0||x0>=W||y0<0||y0>=H) return;
    const imgData=this.ctx.getImageData(0,0,W,H),d=imgData.data;
    const base=(y0*W+x0)*4;
    const tr=d[base],tg=d[base+1],tb=d[base+2],ta=d[base+3];
    const fc=_hex2rgb(this.toolColor);
    if(tr===fc.r&&tg===fc.g&&tb===fc.b) return;
    const TOL=30;
    const match=i=>Math.abs(d[i]-tr)<=TOL&&Math.abs(d[i+1]-tg)<=TOL&&Math.abs(d[i+2]-tb)<=TOL&&Math.abs(d[i+3]-ta)<=TOL;
    const queue=new Int32Array(W*H),visited=new Uint8Array(W*H);
    let head=0,tail=0,mx1=x0,mx2=x0,my1=y0,my2=y0;
    queue[tail++]=x0+y0*W;visited[x0+y0*W]=1;
    while(head<tail){
      const pos=queue[head++],px=pos%W,py=(pos-px)/W,i=pos*4;
      d[i]=fc.r;d[i+1]=fc.g;d[i+2]=fc.b;d[i+3]=255;
      if(px<mx1)mx1=px;if(px>mx2)mx2=px;if(py<my1)my1=py;if(py>my2)my2=py;
      for(const[nx,ny]of[[px-1,py],[px+1,py],[px,py-1],[px,py+1]]){
        if(nx<0||nx>=W||ny<0||ny>=H)continue;
        const ni=ny*W+nx;
        if(!visited[ni]&&match(ni*4)){visited[ni]=1;queue[tail++]=ni;}
      }
    }
    const rw=mx2-mx1+1,rh=my2-my1+1;
    const before=this.ctx.getImageData(mx1,my1,rw,rh);
    this.ctx.putImageData(imgData,0,0);
    const after=this.ctx.getImageData(mx1,my1,rw,rh);
    this._pushCmd({type:'region',layer:'base',x:mx1,y:my1,before,after});
  }

  // ═══════════════════════ UNDO/REDO ═══════════════════════
  _openCmd(pt){
    if(this._pendingCmd) return;
    const isInp=this.activeTool==='inpaint';
    const ctx=isInp?this.iCtx:this.ctx,cnv=isInp?this.inpaint:this.base;
    const before=ctx.getImageData(0,0,cnv.width,cnv.height);
    this._pendingCmd={type:'full',layer:isInp?'inpaint':'base',before,after:null};
  }
  _closeCmd(){
    if(!this._pendingCmd) return;
    const cmd=this._pendingCmd;this._pendingCmd=null;
    const ctx=cmd.layer==='inpaint'?this.iCtx:this.ctx;
    const cnv=cmd.layer==='inpaint'?this.inpaint:this.base;
    cmd.after=ctx.getImageData(0,0,cnv.width,cnv.height);
    this._pushCmd(cmd);
  }
  _pushCmd(cmd){
    this._undoStack.push(cmd);
    if(this._undoStack.length>this.MAX_HISTORY)this._undoStack.shift();
    this._redoStack=[];
  }
  undo(){if(!this._undoStack.length)return false;const cmd=this._undoStack.pop();this._redoStack.push(cmd);this._applyCmd(cmd,'before');return true;}
  redo(){if(!this._redoStack.length)return false;const cmd=this._redoStack.pop();this._undoStack.push(cmd);this._applyCmd(cmd,'after');return true;}
  _applyCmd(cmd,which){const snap=cmd[which];if(!snap)return;const ctx=cmd.layer==='inpaint'?this.iCtx:this.ctx;if(cmd.type==='region')ctx.putImageData(snap,cmd.x,cmd.y);else ctx.putImageData(snap,0,0);}

  // ═══════════════════════ HELPERS ════════════════════════
  fillRect(x,y,w,h,color='#ffffff'){
    x=Math.max(0,x-3);y=Math.max(0,y-3);
    w=Math.min(w+6,this.base.width-x);h=Math.min(h+6,this.base.height-y);
    const before=this.ctx.getImageData(x,y,w,h);
    this.ctx.fillStyle=color;this.ctx.fillRect(x,y,w,h);
    const after=this.ctx.getImageData(x,y,w,h);
    this._pushCmd({type:'region',layer:'base',x,y,before,after});
  }

  getInpaintMask(){
    const W=this.inpaint.width,H=this.inpaint.height;
    const d=this.iCtx.getImageData(0,0,W,H).data;
    const mask=new Uint8Array(W*H);
    for(let i=0;i<W*H;i++) if(d[i*4+3]>30) mask[i]=1;
    return mask;
  }
  clearInpaintLayer(){this.iCtx.clearRect(0,0,this.inpaint.width,this.inpaint.height);}

  // ═══════════════════════ LASSO — máscara real ════════════
  /**
   * getLassoMaskedCrop(points) → HTMLCanvasElement
   *
   * Extrai o crop da bbox do laço, mas aplica a máscara real do polígono:
   * pixels fora do laço ficam brancos (fundo = Tesseract lê melhor).
   * Isso garante que texto de balões adjacentes não contamine o OCR.
   *
   * @param {Array<{x,y}>} points  polígono em coordenadas de canvas
   * @returns {HTMLCanvasElement}
   */
  getLassoMaskedCrop(points) {
    const bbox   = _lassoBbox(points);
    const { x, y, w, h } = bbox;
    const cw = Math.max(1, Math.ceil(w));
    const ch = Math.max(1, Math.ceil(h));

    const out = document.createElement('canvas');
    out.width  = cw;
    out.height = ch;
    const ctx  = out.getContext('2d');

    // 1. Fundo branco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cw, ch);

    // 2. Clip com o polígono do laço (offset pela bbox origin)
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x - x, points[0].y - y);
    for (let i = 1; i < points.length; i++)
      ctx.lineTo(points[i].x - x, points[i].y - y);
    ctx.closePath();
    ctx.clip();

    // 3. Desenha apenas a região da imagem base dentro do clip
    ctx.drawImage(this.base, x, y, w, h, 0, 0, cw, ch);
    ctx.restore();

    return out;
  }

  // ═══════════════════════ STROKE — faixa de linha ════════
  /**
   * getStrokeCrop(p1, p2, thickness) → { canvas, angle, rect }
   *
   * Extrai uma faixa ao redor da linha p1→p2 com altura = thickness,
   * des-rotacionada para que o Tesseract receba texto horizontal.
   * O canvas de saída tem largura = comprimento da linha, altura = thickness.
   *
   * @param {{x,y}} p1
   * @param {{x,y}} p2
   * @param {number} thickness  altura da faixa em px (default 80)
   */
  getStrokeCrop(p1, p2, thickness = 80) {
    const dx    = p2.x - p1.x;
    const dy    = p2.y - p1.y;
    const len   = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);  // radians, linha em relação ao eixo X
    const deg   = angle * 180 / Math.PI;

    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    const outW = Math.ceil(len);
    const outH = thickness;

    const out = document.createElement('canvas');
    out.width  = outW;
    out.height = outH;
    const ctx  = out.getContext('2d');

    // Fundo branco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, outW, outH);

    // Transforma: center na origem, des-rotaciona, centraliza no canvas de saída
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(-angle);
    ctx.drawImage(this.base, cx - outW / 2 * 1.2, cy - outH / 2,
                              outW * 1.2, outH,
                             -outW / 2 * 1.2, -outH / 2, outW * 1.2, outH);
    ctx.restore();

    // Gera bbox na imagem original correspondente à faixa
    const rect = _strokeBbox(p1, p2, thickness).rect;

    return { canvas: out, angle: deg, rect };
  }

  // ═══════════════════════ ROTATED CROP ═══════════════════
  getRotatedCrop(rect, angle) {
    const { x, y, w, h } = rect;
    if (!angle) {
      const out = Object.assign(document.createElement('canvas'), { width: Math.ceil(w), height: Math.ceil(h) });
      out.getContext('2d').drawImage(this.base, x, y, w, h, 0, 0, w, h);
      return out;
    }
    const rad = angle * Math.PI / 180;
    const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
    const rw = Math.ceil(w * cos + h * sin);
    const rh = Math.ceil(w * sin + h * cos);
    const PAD = Math.ceil(Math.max(w, h) * 0.15);
    const sx  = Math.max(0, x - PAD), sy = Math.max(0, y - PAD);
    const sw  = Math.min(w + PAD * 2, this.base.width  - sx);
    const sh  = Math.min(h + PAD * 2, this.base.height - sy);
    const tmp = Object.assign(document.createElement('canvas'), { width: sw, height: sh });
    tmp.getContext('2d').drawImage(this.base, sx, sy, sw, sh, 0, 0, sw, sh);
    const out = Object.assign(document.createElement('canvas'), { width: rw, height: rh });
    const oc  = out.getContext('2d');
    oc.translate(rw / 2, rh / 2);
    oc.rotate(-rad);
    oc.drawImage(tmp, -(sw / 2), -(sh / 2), sw, sh);
    return out;
  }

  // ═══════════════════════ SELECTION OVERLAY ═══════════════
  _drawSelOverlay(cursorPt) {
    const ctx = this.sCtx;
    ctx.clearRect(0, 0, this.selection.width, this.selection.height);

    // ── Lasso ──────────────────────────────────────────────
    if (this.activeTool === 'lasso' && this._lassoPoints.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#e63946'; ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(this._lassoPoints[0].x, this._lassoPoints[0].y);
      for (const p of this._lassoPoints) ctx.lineTo(p.x, p.y);
      if (cursorPt) ctx.lineTo(cursorPt.x, cursorPt.y);
      ctx.stroke();
      if (!cursorPt && this._lassoPoints.length > 2) {
        ctx.closePath();
        ctx.fillStyle = 'rgba(230,57,70,.08)'; ctx.fill();
      }
      ctx.restore();
      return;
    }

    // ── Stroke tool: linha + faixa visualizada ─────────────
    if (this.activeTool === 'stroke' && this._strokeStart) {
      const p1 = this._strokeStart;
      const p2 = this._strokeEnd ?? p1;
      ctx.save();
      // Linha principal
      ctx.strokeStyle = '#f4a261'; ctx.lineWidth = 2.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
      // Ponto inicial
      ctx.fillStyle = '#f4a261';
      ctx.beginPath(); ctx.arc(p1.x, p1.y, 5, 0, Math.PI * 2); ctx.fill();
      // Faixa perpendicular (visualização)
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        const PAD = 30; // meia-espessura da faixa
        const nx = -dy / len * PAD, ny = dx / len * PAD;
        ctx.strokeStyle = 'rgba(244,162,97,0.45)'; ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(p1.x + nx, p1.y + ny);
        ctx.lineTo(p2.x + nx, p2.y + ny);
        ctx.lineTo(p2.x - nx, p2.y - ny);
        ctx.lineTo(p1.x - nx, p1.y - ny);
        ctx.closePath(); ctx.stroke();
        ctx.fillStyle = 'rgba(244,162,97,0.08)'; ctx.fill();
      }
      ctx.restore();
      return;
    }

    if (!this._selRect) return;
    const { x, y, w, h } = this._selRect;
    ctx.save();
    if (this._selAngle) {
      const cx = x + w / 2, cy = y + h / 2;
      ctx.translate(cx, cy);
      ctx.rotate(this._selAngle * Math.PI / 180);
      ctx.translate(-cx, -cy);
    }
    const isTextBox = this.activeTool === 'text-box';
    ctx.strokeStyle = isTextBox ? '#f4a261' : '#e63946';
    ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = isTextBox ? 'rgba(244,162,97,.1)' : 'rgba(230,57,70,.08)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  clearSelection() {
    this._selRect = null; this._selStart = null; this._selAngle = 0;
    this._lassoPoints = []; this._lassoActive = false;
    this._strokeStart = null; this._strokeEnd = null; this._strokeActive = false;
    this.sCtx.clearRect(0, 0, this.selection.width, this.selection.height);
    if (this.onSelectionChange) this.onSelectionChange(null, null);
  }

  // ═══════════════════════ OVERLAY ═════════════════════════
  drawOverlay(blocks, selectedId = null) {
    const ctx = this.oCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
    for (const b of blocks) {
      if (!b.visible) continue;
      const { x, y, w, h } = b.bbox;
      const sel = b.id === selectedId;
      const col = sel ? '#e63946' : b.applied ? '#2d9e5f' : b.manual ? '#f4a261' : '#457b9d';
      ctx.save();
      if (b.angle) {
        const cx = x + w/2, cy = y + h/2;
        ctx.translate(cx, cy); ctx.rotate(b.angle * Math.PI/180); ctx.translate(-cx, -cy);
      }
      ctx.strokeStyle=col; ctx.lineWidth=sel?2.5:1.5;
      ctx.globalAlpha=b.applied?.35:1; ctx.setLineDash(sel?[]:[4,3]);
      ctx.strokeRect(x+.5,y+.5,w,h);
      ctx.globalAlpha=1; ctx.setLineDash([]);
      ctx.fillStyle=col;
      const lbl=`#${b.id.split('-')[1]??b.id}`;
      const tw=Math.max(ctx.measureText(lbl).width+6,18);
      ctx.fillRect(x,y-14,tw,14);
      ctx.fillStyle='#fff'; ctx.font='bold 9px Nunito,sans-serif';
      ctx.textBaseline='bottom'; ctx.fillText(lbl,x+3,y);
      ctx.restore();
    }
  }
  clearOverlay(){this.oCtx.clearRect(0,0,this.overlay.width,this.overlay.height);}

  // ═══════════════════════ EXPORT ══════════════════════════
  exportImage(textBoxes) {
    const {width:W,height:H}=this.base;
    const out=Object.assign(document.createElement('canvas'),{width:W,height:H});
    const oc=out.getContext('2d');
    oc.drawImage(this.base,0,0);
    if(this.layerVisible.inpaint) oc.drawImage(this.inpaint,0,0);
    for(const box of textBoxes) renderBoxToCanvas(oc,box);
    return out.toDataURL('image/png');
  }
}

// ═══════════════════════ RENDER BOX ══════════════════════════
export function renderBoxToCanvas(ctx, box) {
  const{x,y,w,h,text,fontSize,fontFamily,color,bgColor,bgOpacity,align,rotation=0}=box;
  if (!text?.trim()) return;
  ctx.save();
  if (rotation){const cx=x+w/2,cy=y+h/2;ctx.translate(cx,cy);ctx.rotate(rotation*Math.PI/180);ctx.translate(-cx,-cy);}
  if(bgOpacity>0){
    ctx.globalAlpha=bgOpacity;ctx.fillStyle=bgColor||'#ffffff';
    ctx.beginPath();
    if(ctx.roundRect)ctx.roundRect(x-3,y-3,w+6,h+6,4);else ctx.rect(x-3,y-3,w+6,h+6);
    ctx.fill();ctx.globalAlpha=1;
  }
  ctx.font=`bold ${fontSize}px '${fontFamily}',sans-serif`;
  ctx.fillStyle=color||'#000000';ctx.textBaseline='top';ctx.textAlign=align||'center';
  const lineH=fontSize*1.3;
  const tx=align==='right'?x+w-5:align==='left'?x+5:x+w/2;
  _wrap(ctx,text,w-10).forEach((l,i)=>ctx.fillText(l,tx,y+i*lineH+4));
  ctx.restore();
}

// ── Helpers ──────────────────────────────────────────────────
function _wrap(ctx,text,maxW){
  const out=[];
  for(const para of text.split('\n')){
    if(!para){out.push('');continue;}
    let cur='';
    for(const w of para.split(' ')){const t=cur?`${cur} ${w}`:w;if(ctx.measureText(t).width>maxW&&cur){out.push(cur);cur=w;}else cur=t;}
    if(cur)out.push(cur);
  }
  return out.length?out:[text];
}
function _normRect(a,b){return{x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),w:Math.abs(b.x-a.x),h:Math.abs(b.y-a.y)};}
function _lassoBbox(pts){
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y);
  const x=Math.min(...xs),y=Math.min(...ys);
  return{x,y,w:Math.max(...xs)-x,h:Math.max(...ys)-y};
}

/**
 * Calcula a bbox da faixa ao redor da linha p1→p2.
 * Retorna { rect:{x,y,w,h}, angle:degrees }.
 * A bbox é o bounding-box axis-aligned da faixa rotacionada.
 */
function _strokeBbox(p1, p2, thickness = 80) {
  const dx  = p2.x - p1.x;
  const dy  = p2.y - p1.y;
  const len = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  if (len < 1) return { rect: { x: p1.x - 10, y: p1.y - 10, w: 20, h: 20 }, angle: 0 };

  const ux = dx / len, uy = dy / len;       // unit vector along line
  const nx = -uy, ny = ux;                  // unit normal (perpendicular)
  const half = thickness / 2;

  // 4 corners of the strip
  const corners = [
    { x: p1.x + nx * half, y: p1.y + ny * half },
    { x: p1.x - nx * half, y: p1.y - ny * half },
    { x: p2.x + nx * half, y: p2.y + ny * half },
    { x: p2.x - nx * half, y: p2.y - ny * half },
  ];

  const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
  const bx = Math.min(...xs), by = Math.min(...ys);
  return {
    rect:  { x: bx, y: by, w: Math.max(...xs) - bx, h: Math.max(...ys) - by },
    angle,
  };
}

function _pd(t){return Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY);}
function _hex2rgb(hex){const n=hex.replace('#','');return{r:parseInt(n.slice(0,2),16),g:parseInt(n.slice(2,4),16),b:parseInt(n.slice(4,6),16)};}
