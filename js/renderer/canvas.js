/**
 * renderer/canvas.js — MET10 (reescrito)
 *
 * CORREÇÕES:
 *  - stagePoint usa o próprio overlay.getBoundingClientRect() para converter
 *    coordenadas de tela → coordenadas do canvas (correto com CSS transform)
 *  - setTool gerencia pointer-events do overlay: ferramentas de desenho/seleção
 *    ativam o overlay; tool='select' com caixas existentes pode precisar
 *    que o overlay fique inativo. Solução: overlay sempre ativo MAS
 *    met-boxes ficam com z-index maior via CSS (não via JS aqui)
 *  - fitToStage usa requestAnimationFrame para garantir que o layout já ocorreu
 *  - transform é aplicado via classe world que tem transform-origin:0 0
 */

export class CanvasRenderer {
  constructor({ stage, world, base, inpaint, selection, overlay }) {
    this.stage     = stage;
    this.world     = world;   // #canvas-world (o div que é transformado)
    this.base      = base;
    this.inpaint   = inpaint;
    this.selection = selection;
    this.overlay   = overlay;

    this.bCtx = base.getContext('2d',      { willReadFrequently: true });
    this.iCtx = inpaint.getContext('2d',   { willReadFrequently: true });
    this.sCtx = selection.getContext('2d');
    this.oCtx = overlay.getContext('2d');

    this.scale = 1;
    this.tx    = 0;
    this.ty    = 0;

    this.activeTool  = 'select';
    this.toolSize    = 20;
    this.toolColor   = '#ffffff';
    this._drawing    = false;
    this._lastPt     = null;

    this._selStart   = null;
    this._selRect    = null;
    this._lassoPoints = [];
    this._lassoActive = false;
    this._strokeStart = null;
    this._strokeEnd   = null;

    this._cloneSource = null;
    this._cloneSet    = false;
    this._cloneOffset = null;

    this._panning   = false;
    this._panStart  = { x: 0, y: 0 };
    this._panOrigin = { x: 0, y: 0 };

    // Callbacks
    this.onSelectionChange = null;
    this.onZoomChange      = null;
    this.onCanvasChange    = null;

    this._bindEvents();
  }

  // ── Carregar imagem ──────────────────────────────────────────────────

  loadImage(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    [this.base, this.inpaint, this.selection, this.overlay].forEach(c => {
      c.width = w; c.height = h;
    });
    this.bCtx.drawImage(img, 0, 0);
    this.clearSelection();
    // fitToStage após o próximo frame (layout garantido)
    requestAnimationFrame(() => this.fitToStage());
  }

  // ── Transform ────────────────────────────────────────────────────────

  _applyTransform() {
    this.world.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
    this.onZoomChange?.(this.scale);
  }

  _setTransform(tx, ty, s) {
    this.tx = tx; this.ty = ty; this.scale = s;
    this._applyTransform();
  }

  setScale(s, cx, cy) {
    s = Math.max(0.05, Math.min(20, s));
    const r = this.stage.getBoundingClientRect();
    cx = cx ?? r.width / 2;
    cy = cy ?? r.height / 2;
    // Ponto no canvas que deve ficar fixo
    const wx = (cx - this.tx) / this.scale;
    const wy = (cy - this.ty) / this.scale;
    this._setTransform(cx - wx * s, cy - wy * s, s);
  }

  fitToStage() {
    const r  = this.stage.getBoundingClientRect();
    const iw = this.base.width, ih = this.base.height;
    if (!iw || !ih || !r.width || !r.height) return;
    const s  = Math.min((r.width - 40) / iw, (r.height - 40) / ih, 1);
    const tx = (r.width  - iw * s) / 2;
    const ty = (r.height - ih * s) / 2;
    this._setTransform(tx, ty, s);
  }

  // Converte coordenadas de tela (clientX/Y) → coordenadas do canvas
  // CORRETO: usa o overlay transformado para obter a escala real
  toCanvas(clientX, clientY) {
    // overlay tem a mesma transform que o canvas, mas getBoundingClientRect()
    // retorna as dimensões REAIS na tela (já com scale aplicado).
    // Então: canvasX = (clientX - overlay.left) / scale
    // onde scale = overlay.width / canvas.width (ou equivalentemente this.scale)
    const r = this.overlay.getBoundingClientRect();
    return {
      x: (clientX - r.left) / this.scale,
      y: (clientY - r.top)  / this.scale,
    };
  }

  // ── Snapshots ────────────────────────────────────────────────────────

  captureSnapshot() {
    return this.bCtx.getImageData(0, 0, this.base.width, this.base.height);
  }

  restoreSnapshot(imageData) {
    this.bCtx.putImageData(imageData, 0, 0);
  }

  getRegionSnapshot(x, y, w, h) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(Math.ceil(w), this.base.width  - x);
    h = Math.min(Math.ceil(h), this.base.height - y);
    return this.bCtx.getImageData(x, y, w, h);
  }

  restoreRegion(snapshot, x, y) {
    this.bCtx.putImageData(snapshot, Math.floor(x), Math.floor(y));
    this.onCanvasChange?.();
  }

  fillRegion(x, y, w, h, color = '#ffffff') {
    this.bCtx.fillStyle = color;
    this.bCtx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
    this.onCanvasChange?.();
  }

  // ── Seleção visual ───────────────────────────────────────────────────

  clearSelection() {
    this.sCtx.clearRect(0, 0, this.selection.width, this.selection.height);
    this._selStart = null; this._selRect = null;
    this._lassoPoints = []; this._lassoActive = false;
    this._strokeStart = null; this._strokeEnd = null;
    this.onSelectionChange?.(null, this.activeTool);
  }

  _drawSelRect(rect) {
    const ctx = this.sCtx;
    ctx.clearRect(0, 0, this.selection.width, this.selection.height);
    ctx.save();
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth   = 1.5 / this.scale;
    ctx.setLineDash([5 / this.scale, 3 / this.scale]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = 'rgba(0,212,255,0.06)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);
    // Handles de canto
    const hs = 5 / this.scale;
    ctx.fillStyle = '#00d4ff';
    [[rect.x,rect.y],[rect.x+rect.w,rect.y],[rect.x,rect.y+rect.h],[rect.x+rect.w,rect.y+rect.h]]
      .forEach(([hx,hy]) => ctx.fillRect(hx-hs/2, hy-hs/2, hs, hs));
    ctx.restore();
  }

  _drawLasso(pts, closed = false) {
    if (pts.length < 2) return;
    const ctx = this.sCtx;
    ctx.clearRect(0, 0, this.selection.width, this.selection.height);
    ctx.save();
    ctx.strokeStyle = '#ff6b2b';
    ctx.lineWidth   = 1.5 / this.scale;
    ctx.setLineDash([4/this.scale, 3/this.scale]);
    ctx.beginPath();
    pts.forEach((p,i) => i === 0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
    if (closed) { ctx.closePath(); ctx.fillStyle='rgba(255,107,43,0.1)'; ctx.fill(); }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _drawStroke(p1, p2) {
    const ctx = this.sCtx;
    ctx.clearRect(0, 0, this.selection.width, this.selection.height);
    ctx.save();
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth   = 2.5 / this.scale;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(p1.x,p1.y); ctx.lineTo(p2.x,p2.y); ctx.stroke();
    ctx.restore();
  }

  // ── Ferramentas de pintura ───────────────────────────────────────────

  _brushAt(x, y) {
    const ctx = this.bCtx;
    ctx.globalCompositeOperation = this.activeTool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.fillStyle = this.toolColor;
    ctx.beginPath();
    ctx.arc(x, y, this.toolSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    this.onCanvasChange?.();
  }

  _cloneAt(x, y) {
    if (!this._cloneSet || !this._cloneSource) return;
    const r   = this.toolSize / 2;
    const ox  = x + this._cloneOffset.x;
    const oy  = y + this._cloneOffset.y;
    const ctx = this.bCtx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.base, ox-r, oy-r, r*2, r*2, x-r, y-r, r*2, r*2);
    ctx.restore();
    this.onCanvasChange?.();
  }

  // ── Ferramenta ───────────────────────────────────────────────────────

  setTool(tool) {
    this.activeTool = tool;
    this.clearSelection();
    const cursors = {
      select:'crosshair', lasso:'crosshair', stroke:'crosshair',
      brush:'cell', eraser:'cell', clone:'copy', pan:'grab'
    };
    this.stage.style.cursor = cursors[tool] || 'default';
  }

  // ── Eventos ──────────────────────────────────────────────────────────

  _bindEvents() {
    const ev = e => ({ x: e.clientX, y: e.clientY, altKey: e.altKey, button: e.button });

    this.overlay.addEventListener('mousedown',  e => { e.preventDefault(); this._onDown(ev(e)); });
    this.overlay.addEventListener('mousemove',  e => this._onMove(ev(e)));
    this.overlay.addEventListener('mouseup',    e => this._onUp(ev(e)));
    this.overlay.addEventListener('mouseleave', e => this._onUp(ev(e)));

    this.overlay.addEventListener('touchstart', e => { e.preventDefault(); this._onDown(ev(e.touches[0])); }, { passive: false });
    this.overlay.addEventListener('touchmove',  e => { e.preventDefault(); this._onMove(ev(e.touches[0])); }, { passive: false });
    this.overlay.addEventListener('touchend',   () => this._onUp({}), { passive: false });

    this.stage.addEventListener('wheel', e => {
      e.preventDefault();
      this.setScale(this.scale * (e.deltaY < 0 ? 1.1 : 0.9), e.clientX, e.clientY);
    }, { passive: false });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') this.clearSelection();
      if (e.key === '0') this.fitToStage();
    });
  }

  _onDown(e) {
    const pt  = this.toCanvas(e.x, e.y);
    const pan = e.button === 1 || e.altKey || this.activeTool === 'pan';

    if (pan) {
      this._panning   = true;
      this._panStart  = { x: e.x, y: e.y };
      this._panOrigin = { x: this.tx, y: this.ty };
      this.stage.style.cursor = 'grabbing';
      return;
    }

    switch (this.activeTool) {
      case 'select':
        this._selStart = pt; this._selRect = null;
        break;
      case 'lasso':
        this._lassoActive = true; this._lassoPoints = [pt];
        break;
      case 'stroke':
        this._strokeStart = pt; this._strokeEnd = null;
        break;
      case 'brush': case 'eraser':
        this._drawing = true; this._lastPt = pt;
        this._brushAt(pt.x, pt.y);
        break;
      case 'clone':
        if (e.altKey) {
          this._cloneSource = pt; this._cloneSet = false;
        } else if (this._cloneSource) {
          if (!this._cloneSet) {
            this._cloneOffset = { x: this._cloneSource.x - pt.x, y: this._cloneSource.y - pt.y };
            this._cloneSet = true;
          }
          this._drawing = true; this._cloneAt(pt.x, pt.y);
        }
        break;
    }
  }

  _onMove(e) {
    if (this._panning) {
      this._setTransform(
        this._panOrigin.x + (e.x - this._panStart.x),
        this._panOrigin.y + (e.y - this._panStart.y),
        this.scale
      );
      return;
    }

    const pt = this.toCanvas(e.x, e.y);

    switch (this.activeTool) {
      case 'select':
        if (!this._selStart) break;
        this._selRect = _rect(this._selStart, pt);
        this._drawSelRect(this._selRect);
        break;
      case 'lasso':
        if (!this._lassoActive) break;
        this._lassoPoints.push(pt);
        this._drawLasso(this._lassoPoints);
        break;
      case 'stroke':
        if (!this._strokeStart) break;
        this._strokeEnd = pt;
        this._drawStroke(this._strokeStart, pt);
        break;
      case 'brush': case 'eraser':
        if (!this._drawing) break;
        this._brushAt(pt.x, pt.y);
        break;
      case 'clone':
        if (!this._drawing) break;
        this._cloneAt(pt.x, pt.y);
        break;
    }
  }

  _onUp(e) {
    if (this._panning) {
      this._panning = false;
      const cursors = { select:'crosshair', lasso:'crosshair', stroke:'crosshair', brush:'cell', eraser:'cell', clone:'copy', pan:'grab' };
      this.stage.style.cursor = cursors[this.activeTool] || 'default';
      return;
    }

    switch (this.activeTool) {
      case 'select':
        if (this._selRect && this._selRect.w > 4 && this._selRect.h > 4)
          this.onSelectionChange?.({ rect: this._selRect, points: null, angle: 0 }, 'select');
        this._selStart = null;
        break;
      case 'lasso':
        if (this._lassoActive && this._lassoPoints.length > 3) {
          this._drawLasso(this._lassoPoints, true);
          this.onSelectionChange?.({
            rect: _bbox(this._lassoPoints), points: this._lassoPoints, angle: 0
          }, 'lasso');
        }
        this._lassoActive = false;
        break;
      case 'stroke':
        if (this._strokeStart && this._strokeEnd) {
          const dx = this._strokeEnd.x - this._strokeStart.x;
          const dy = this._strokeEnd.y - this._strokeStart.y;
          if (Math.sqrt(dx*dx+dy*dy) > 10)
            this.onSelectionChange?.({
              rect: _bbox([this._strokeStart, this._strokeEnd]),
              points: [this._strokeStart, this._strokeEnd],
              angle: Math.atan2(dy,dx) * 180/Math.PI,
            }, 'stroke');
        }
        break;
      case 'brush': case 'eraser': case 'clone':
        this._drawing = false;
        break;
    }
  }
}

function _rect(a, b) {
  return { x:Math.min(a.x,b.x), y:Math.min(a.y,b.y), w:Math.abs(b.x-a.x), h:Math.abs(b.y-a.y) };
}
function _bbox(pts) {
  const xs=pts.map(p=>p.x), ys=pts.map(p=>p.y);
  const x=Math.min(...xs), y=Math.min(...ys);
  return { x, y, w:Math.max(...xs)-x, h:Math.max(...ys)-y };
}
