/**
 * renderer/canvas.js — MET10
 * Manages all canvas layers, viewport transforms, drawing tools.
 * No direct state mutations — communicates via callbacks.
 */

export class CanvasRenderer {
  /**
   * @param {{ stage, base, inpaint, selection, overlay }} canvases
   */
  constructor({ stage, base, inpaint, selection, overlay }) {
    this.stage     = stage;
    this.base      = base;
    this.inpaint   = inpaint;
    this.selection = selection;
    this.overlay   = overlay;

    this.bCtx = base.getContext('2d', { willReadFrequently: true });
    this.iCtx = inpaint.getContext('2d', { willReadFrequently: true });
    this.sCtx = selection.getContext('2d');
    this.oCtx = overlay.getContext('2d');

    // Transform state
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
    this._rafId = null;
    this._dirty = false;

    // Tool state
    this.activeTool = 'select';
    this.toolSize = 20;
    this.toolColor = '#ffffff';
    this._drawing = false;
    this._lastPt = null;

    // Selection state
    this._selStart = null;
    this._selRect  = null;
    this._lassoPoints = [];
    this._lassoActive = false;
    this._strokeStart = null;
    this._strokeEnd   = null;

    // Clone state
    this._cloneSource = null;
    this._cloneSet = false;
    this._cloneOffset = null;

    // Pan state
    this._panning = false;
    this._panStart = { x: 0, y: 0 };
    this._panOrigin = { x: 0, y: 0 };

    // Callbacks (set by app layer)
    this.onSelectionChange = null;   // (selectionData | null, tool) => void
    this.onZoomChange = null;        // (scale) => void
    this.onCanvasChange = null;      // () => void  (notify state manager)

    this._bindEvents();
  }

  // ── Image Load ──────────────────────────────────────────────────────────

  loadImage(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    [this.base, this.inpaint, this.selection, this.overlay].forEach(c => {
      c.width = w; c.height = h;
    });
    this.bCtx.drawImage(img, 0, 0);
    this.clearSelection();
    this.fitToStage();
  }

  // ── Transform ───────────────────────────────────────────────────────────

  _schedTransform() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (this._dirty) {
        // Apply transform to a wrapper div that contains all canvases
        const w = this.base.parentElement;
        if (w) w.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
        this._dirty = false;
      }
    });
  }

  _setTransform(tx, ty, s) {
    this.tx = tx; this.ty = ty; this.scale = s;
    this._dirty = true; this._schedTransform();
    this.onZoomChange?.(s);
  }

  setScale(s, cx, cy) {
    s = Math.max(0.05, Math.min(10, s));
    const r = this.stage.getBoundingClientRect();
    cx = cx ?? r.width / 2; cy = cy ?? r.height / 2;
    const wx = (cx - this.tx) / this.scale;
    const wy = (cy - this.ty) / this.scale;
    this._setTransform(cx - wx * s, cy - wy * s, s);
  }

  fitToStage() {
    const r = this.stage.getBoundingClientRect();
    const iw = this.base.width, ih = this.base.height;
    if (!iw || !ih) return;
    const s = Math.min((r.width - 40) / iw, (r.height - 40) / ih, 1);
    this._setTransform((r.width - iw * s) / 2, (r.height - ih * s) / 2, s);
  }

  canvasPoint(clientX, clientY) {
    const r = this.base.getBoundingClientRect();
    return { x: (clientX - r.left) / this.scale, y: (clientY - r.top) / this.scale };
  }

  stagePoint(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    return {
      x: (clientX - r.left - this.tx) / this.scale,
      y: (clientY - r.top  - this.ty) / this.scale,
    };
  }

  // ── Canvas Undo ─────────────────────────────────────────────────────────

  captureSnapshot() {
    return this.bCtx.getImageData(0, 0, this.base.width, this.base.height);
  }

  restoreSnapshot(imageData) {
    this.bCtx.putImageData(imageData, 0, 0);
  }

  // ── Drawing operations ──────────────────────────────────────────────────

  fillRegion(x, y, w, h, color = '#ffffff') {
    this.bCtx.fillStyle = color;
    this.bCtx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
    this.onCanvasChange?.();
  }

  getRegionSnapshot(x, y, w, h) {
    x = Math.max(0, Math.floor(x)); y = Math.max(0, Math.floor(y));
    w = Math.min(Math.ceil(w), this.base.width - x);
    h = Math.min(Math.ceil(h), this.base.height - y);
    return this.bCtx.getImageData(x, y, w, h);
  }

  restoreRegion(snapshot, x, y) {
    this.bCtx.putImageData(snapshot, Math.floor(x), Math.floor(y));
    this.onCanvasChange?.();
  }

  // ── Selection rendering ─────────────────────────────────────────────────

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
    ctx.strokeStyle = '#00d4ff';
    ctx.lineWidth = 2 / this.scale;
    ctx.setLineDash([6 / this.scale, 3 / this.scale]);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.setLineDash([]);

    // Corner handles
    const hs = 6 / this.scale;
    ctx.fillStyle = '#00d4ff';
    [[rect.x, rect.y],[rect.x+rect.w, rect.y],[rect.x, rect.y+rect.h],[rect.x+rect.w, rect.y+rect.h]].forEach(([hx,hy]) => {
      ctx.fillRect(hx - hs/2, hy - hs/2, hs, hs);
    });
  }

  _drawLasso(points, closed = false) {
    if (points.length < 2) return;
    const ctx = this.sCtx;
    ctx.clearRect(0, 0, this.selection.width, this.selection.height);
    ctx.strokeStyle = '#ff6b2b';
    ctx.lineWidth = 2 / this.scale;
    ctx.setLineDash([5 / this.scale, 3 / this.scale]);
    ctx.beginPath();
    points.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
    if (closed) ctx.closePath();
    ctx.stroke();

    if (closed) {
      ctx.fillStyle = 'rgba(255, 107, 43, 0.15)';
      ctx.fill();
    }
    ctx.setLineDash([]);
  }

  _drawStroke(p1, p2) {
    const ctx = this.sCtx;
    ctx.clearRect(0, 0, this.selection.width, this.selection.height);
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 3 / this.scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
    // Arrow
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx*dx + dy*dy);
    if (len > 0) {
      const ux = dx/len, uy = dy/len;
      const as = 10 / this.scale;
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p2.x - ux*as + uy*as*0.4, p2.y - uy*as - ux*as*0.4);
      ctx.lineTo(p2.x - ux*as - uy*as*0.4, p2.y - uy*as + ux*as*0.4);
      ctx.closePath();
      ctx.fillStyle = '#a855f7';
      ctx.fill();
    }
  }

  // ── Tool brush/erase/clone on base canvas ───────────────────────────────

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
    const ctx = this.bCtx;
    const ox = x + this._cloneOffset.x;
    const oy = y + this._cloneOffset.y;
    const r = this.toolSize / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.base, ox - r, oy - r, r*2, r*2, x - r, y - r, r*2, r*2);
    ctx.restore();
    this.onCanvasChange?.();
  }

  // ── Event binding ───────────────────────────────────────────────────────

  _bindEvents() {
    const getEvt = e => ({ x: e.clientX, y: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey, button: e.button });

    this.overlay.addEventListener('mousedown', e => this._onDown(getEvt(e)));
    this.overlay.addEventListener('mousemove', e => this._onMove(getEvt(e)));
    this.overlay.addEventListener('mouseup',   e => this._onUp(getEvt(e)));
    this.overlay.addEventListener('mouseleave',e => this._onUp(getEvt(e)));

    // Touch
    this.overlay.addEventListener('touchstart', e => { e.preventDefault(); const t = e.touches[0]; this._onDown(getEvt(t)); }, { passive: false });
    this.overlay.addEventListener('touchmove',  e => { e.preventDefault(); const t = e.touches[0]; this._onMove(getEvt(t)); }, { passive: false });
    this.overlay.addEventListener('touchend',   e => { this._onUp({}); }, { passive: false });

    // Zoom
    this.stage.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.setScale(this.scale * factor, e.clientX, e.clientY);
    }, { passive: false });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.clearSelection();
      if (e.key === '+' || e.key === '=') this.setScale(this.scale * 1.2);
      if (e.key === '-') this.setScale(this.scale / 1.2);
      if (e.key === '0') this.fitToStage();
    });
  }

  _onDown(e) {
    const pt = this.stagePoint(e.x, e.y);
    const isPan = e.button === 1 || e.altKey || this.activeTool === 'pan';

    if (isPan) {
      this._panning = true;
      this._panStart = { x: e.x, y: e.y };
      this._panOrigin = { x: this.tx, y: this.ty };
      return;
    }

    switch (this.activeTool) {
      case 'select':
        this._selStart = pt; this._selRect = null;
        break;
      case 'lasso':
        this._lassoActive = true;
        this._lassoPoints = [pt];
        break;
      case 'stroke':
        this._strokeStart = pt; this._strokeEnd = null;
        break;
      case 'brush':
      case 'eraser':
        this._drawing = true; this._lastPt = pt;
        this._brushAt(pt.x, pt.y);
        break;
      case 'clone':
        if (e.altKey) {
          this._cloneSource = { x: pt.x, y: pt.y };
          this._cloneSet = false;
        } else if (this._cloneSource) {
          if (!this._cloneSet) {
            this._cloneOffset = { x: this._cloneSource.x - pt.x, y: this._cloneSource.y - pt.y };
            this._cloneSet = true;
          }
          this._drawing = true; this._lastPt = pt;
          this._cloneAt(pt.x, pt.y);
        }
        break;
    }
  }

  _onMove(e) {
    const pt = this.stagePoint(e.x, e.y);

    if (this._panning) {
      this._setTransform(this._panOrigin.x + (e.x - this._panStart.x), this._panOrigin.y + (e.y - this._panStart.y), this.scale);
      return;
    }

    switch (this.activeTool) {
      case 'select':
        if (!this._selStart) break;
        const r = _makeRect(this._selStart, pt);
        this._selRect = r;
        this._drawSelRect(r);
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
      case 'brush':
      case 'eraser':
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
    if (this._panning) { this._panning = false; return; }

    switch (this.activeTool) {
      case 'select':
        if (this._selRect && this._selRect.w > 4 && this._selRect.h > 4) {
          this.onSelectionChange?.({ rect: this._selRect, points: null, angle: 0 }, 'select');
        }
        this._selStart = null;
        break;
      case 'lasso':
        if (this._lassoActive && this._lassoPoints.length > 3) {
          this._drawLasso(this._lassoPoints, true);
          const bbox = _pointsBBox(this._lassoPoints);
          this.onSelectionChange?.({ rect: bbox, points: this._lassoPoints, angle: 0 }, 'lasso');
        }
        this._lassoActive = false;
        break;
      case 'stroke':
        if (this._strokeStart && this._strokeEnd) {
          const dx = this._strokeEnd.x - this._strokeStart.x;
          const dy = this._strokeEnd.y - this._strokeStart.y;
          const len = Math.sqrt(dx*dx + dy*dy);
          if (len > 10) {
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            this.onSelectionChange?.({
              rect: _pointsBBox([this._strokeStart, this._strokeEnd]),
              points: [this._strokeStart, this._strokeEnd],
              angle,
            }, 'stroke');
          }
        }
        break;
      case 'brush':
      case 'eraser':
      case 'clone':
        this._drawing = false;
        break;
    }
  }

  setTool(tool) {
    this.activeTool = tool;
    this.clearSelection();
    // Update cursor
    const cursors = { select: 'crosshair', lasso: 'crosshair', stroke: 'crosshair', brush: 'cell', eraser: 'cell', clone: 'copy', pan: 'grab' };
    this.overlay.style.cursor = cursors[tool] || 'default';
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _makeRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function _pointsBBox(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
