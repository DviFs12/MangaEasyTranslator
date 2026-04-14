/**
 * editor.js — CanvasEditor v3
 *
 * Gerencia:
 *  • Pan / Zoom sem travar a UI (CSS transform + requestAnimationFrame)
 *  • Ferramentas: brush, eraser, blur, fill, clone stamp, selection rect
 *  • Undo / Redo stack (até 25 estados)
 *  • Exportação combinando base + text boxes
 *
 * Arquitetura de camadas (bottom → top):
 *  #base-canvas      — imagem original + operações destrutivas
 *  #selection-canvas — retângulo de seleção (ephemeral)
 *  #overlay-canvas   — bounding boxes OCR (não-destrutivo)
 *  #preview-canvas   — texto renderizado em tempo real
 *  #text-layer       — caixas DOM para interatividade
 */

export class CanvasEditor {
  constructor({ stage, world, base, selection, overlay }) {
    this.stage     = stage;
    this.world     = world;
    this.base      = base;
    this.selection = selection;
    this.overlay   = overlay;

    this.ctx  = base.getContext('2d', { willReadFrequently: true });
    this.sCtx = selection.getContext('2d');
    this.oCtx = overlay.getContext('2d');

    // ── Transform ──
    this.scale = 1;
    this.tx    = 0;
    this.ty    = 0;
    this._rafId = null;
    this._transformDirty = false;

    // ── Pan ──
    this._panning   = false;
    this._panStart  = { x: 0, y: 0 };
    this._panOrigin = { x: 0, y: 0 };

    // ── Active tool ──
    this.activeTool = null;   // 'brush'|'eraser'|'blur'|'fill'|'clone'|'selection'
    this.toolSize   = 20;
    this.toolColor  = '#ffffff';

    // ── Clone stamp ──
    this._cloneSource = null;  // { x, y } in canvas coords
    this._cloneSet    = false;
    this._cloneOffset = null;

    // ── Selection rect ──
    this._selStart = null;
    this._selRect  = null;    // { x, y, w, h } in canvas coords

    // ── Drawing state ──
    this._drawing = false;
    this._lastPt  = null;

    // ── Undo / Redo ──
    this._undoStack = [];
    this._redoStack = [];
    this.MAX_HISTORY = 25;

    // ── Callbacks ──
    this.onToolChange   = null;  // (toolName) => void
    this.onSelectionChange = null; // (rect|null) => void

    this._bindEvents();
    this._scheduleTransform();
  }

  // ═══════════════════════════════════════════════════
  // IMAGE
  // ═══════════════════════════════════════════════════
  loadImage(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    [this.base, this.selection, this.overlay].forEach(c => {
      c.width = w; c.height = h;
    });
    this.ctx.drawImage(img, 0, 0);
    this._undoStack = [];
    this._redoStack = [];
    this._saveUndo();
  }

  // ═══════════════════════════════════════════════════
  // TRANSFORM  (pan + zoom via CSS transform, rAF-batched)
  // ═══════════════════════════════════════════════════
  _scheduleTransform() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (this._transformDirty) {
        this.world.style.transform = `translate(${this.tx}px,${this.ty}px) scale(${this.scale})`;
        this._transformDirty = false;
      }
    });
  }

  _setTransform(tx, ty, scale) {
    this.tx = tx; this.ty = ty; this.scale = scale;
    this._transformDirty = true;
    this._scheduleTransform();
  }

  setScale(newScale, cx, cy) {
    const rect = this.stage.getBoundingClientRect();
    cx = cx ?? rect.width  / 2;
    cy = cy ?? rect.height / 2;
    const wx = (cx - this.tx) / this.scale;
    const wy = (cy - this.ty) / this.scale;
    const s  = Math.max(0.08, Math.min(5, newScale));
    this._setTransform(cx - wx * s, cy - wy * s, s);
    return s;
  }

  fitToStage(naturalW, naturalH) {
    const r  = this.stage.getBoundingClientRect();
    const s  = Math.min((r.width - 40) / naturalW, (r.height - 40) / naturalH, 1);
    const tx = (r.width  - naturalW * s) / 2;
    const ty = (r.height - naturalH * s) / 2;
    this._setTransform(tx, ty, s);
    return s;
  }

  centerInStage(naturalW, naturalH) {
    const r  = this.stage.getBoundingClientRect();
    this._setTransform((r.width - naturalW * this.scale) / 2, (r.height - naturalH * this.scale) / 2, this.scale);
  }

  /** Pan so that canvas point (cx, cy) is centered in the stage viewport */
  panToCenter(cx, cy) {
    const r = this.stage.getBoundingClientRect();
    this._setTransform(
      r.width  / 2 - cx * this.scale,
      r.height / 2 - cy * this.scale,
      this.scale,
    );
  }

  // ═══════════════════════════════════════════════════
  // TOOL ACTIVATION
  // ═══════════════════════════════════════════════════
  setTool(name) {
    this.activeTool = name;
    // Remove all tool-* classes then add the right one
    this.stage.className = this.stage.className.replace(/\btool-\S+/g, '').trim();
    if (name) this.stage.classList.add(`tool-${name}`);
    this._cloneSet = false; // reset clone on tool switch
    if (this.onToolChange) this.onToolChange(name);
  }

  setToolSize(s)  { this.toolSize  = s; }
  setToolColor(c) { this.toolColor = c; }

  // ═══════════════════════════════════════════════════
  // SCREEN ↔ CANVAS CONVERSION
  // ═══════════════════════════════════════════════════
  _toCanvas(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    return { x: (clientX - r.left - this.tx) / this.scale, y: (clientY - r.top - this.ty) / this.scale };
  }

  // ═══════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════
  _bindEvents() {
    const stage = this.stage;

    // ── Wheel → zoom ──────────────────────────────
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r    = stage.getBoundingClientRect();
      const f    = e.deltaY < 0 ? 1.12 : 0.89;
      const newS = this.setScale(this.scale * f, e.clientX - r.left, e.clientY - r.top);
      if (this._zoomCb) this._zoomCb(newS);
    }, { passive: false });

    // ── MouseDown ─────────────────────────────────
    stage.addEventListener('mousedown', (e) => {
      // Middle / Right / Alt+Left → always pan
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        this._startPan(e.clientX, e.clientY);
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();

      const pt = this._toCanvas(e.clientX, e.clientY);

      if (!this.activeTool) {
        // No tool: pan
        this._startPan(e.clientX, e.clientY);
        return;
      }

      if (this.activeTool === 'selection') {
        this._selStart = pt;
        this._selRect  = null;
        this._drawing  = true;
        return;
      }

      if (this.activeTool === 'clone') {
        if (!this._cloneSet || e.ctrlKey) {
          // Ctrl+click or first click sets source
          this._cloneSource = pt;
          this._cloneSet    = true;
          this._cloneOffset = null;
          this.toast?.('Fonte do Clone definida. Clique novamente para clonar.', 'info');
          return;
        }
        if (!this._cloneOffset) {
          this._cloneOffset = { dx: pt.x - this._cloneSource.x, dy: pt.y - this._cloneSource.y };
        }
      }

      this._drawing = true;
      this._lastPt  = pt;
      this._saveUndo();

      if (this.activeTool === 'fill') {
        this._doFill(pt);
        this._drawing = false;
        return;
      }

      this._doStroke(pt, pt);
    });

    // ── MouseMove ─────────────────────────────────
    document.addEventListener('mousemove', (e) => {
      if (this._panning) {
        this._setTransform(
          this._panOrigin.x + e.clientX - this._panStart.x,
          this._panOrigin.y + e.clientY - this._panStart.y,
          this.scale,
        );
        if (this._zoomCb) this._zoomCb(this.scale);
        return;
      }
      if (!this._drawing) return;

      const pt = this._toCanvas(e.clientX, e.clientY);

      if (this.activeTool === 'selection' && this._selStart) {
        this._selRect = normalizeRect(this._selStart, pt);
        this._drawSelectionOverlay();
        return;
      }

      this._doStroke(this._lastPt, pt);
      this._lastPt = pt;
    });

    // ── MouseUp ───────────────────────────────────
    document.addEventListener('mouseup', () => {
      if (this._panning) { this._panning = false; this.stage.classList.remove('is-panning'); }
      if (this._drawing) {
        this._drawing = false;
        if (this.activeTool === 'selection' && this._selRect) {
          if (this.onSelectionChange) this.onSelectionChange(this._selRect);
        }
      }
    });

    stage.addEventListener('contextmenu', e => e.preventDefault());

    // ── Touch ─────────────────────────────────────
    let lastPinchDist = 0;

    stage.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t  = e.touches[0];
        const pt = this._toCanvas(t.clientX, t.clientY);
        if (!this.activeTool) { this._startPan(t.clientX, t.clientY); return; }
        this._drawing = true;
        this._lastPt  = pt;
        this._saveUndo();
        this._doStroke(pt, pt);
      } else if (e.touches.length === 2) {
        lastPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        this._startPan(
          (e.touches[0].clientX + e.touches[1].clientX) / 2,
          (e.touches[0].clientY + e.touches[1].clientY) / 2,
        );
      }
    }, { passive: false });

    stage.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t  = e.touches[0];
        if (this._panning) {
          this._setTransform(
            this._panOrigin.x + t.clientX - this._panStart.x,
            this._panOrigin.y + t.clientY - this._panStart.y,
            this.scale,
          );
          return;
        }
        if (this._drawing) {
          const pt = this._toCanvas(t.clientX, t.clientY);
          this._doStroke(this._lastPt, pt);
          this._lastPt = pt;
        }
      } else if (e.touches.length === 2) {
        const d = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY,
        );
        if (lastPinchDist) {
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const r  = this.stage.getBoundingClientRect();
          const ns = this.setScale(this.scale * (d / lastPinchDist), cx - r.left, cy - r.top);
          if (this._zoomCb) this._zoomCb(ns);
        }
        lastPinchDist = d;
      }
    }, { passive: false });

    stage.addEventListener('touchend', () => {
      this._panning = false; this._drawing = false;
      this.stage.classList.remove('is-panning');
      lastPinchDist = 0;
    });
  }

  _startPan(x, y) {
    this._panning   = true;
    this._panStart  = { x, y };
    this._panOrigin = { x: this.tx, y: this.ty };
    this.stage.classList.add('is-panning');
  }

  // ═══════════════════════════════════════════════════
  // DRAWING OPERATIONS
  // ═══════════════════════════════════════════════════
  _doStroke(from, to) {
    const ctx  = this.ctx;
    const r    = this.toolSize / 2;
    const tool = this.activeTool;

    if (tool === 'brush') {
      ctx.save();
      ctx.strokeStyle = this.toolColor;
      ctx.lineWidth   = this.toolSize;
      ctx.lineCap     = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();

    } else if (tool === 'eraser') {
      // Eraser: paint with white (or detected background color)
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = this.toolSize;
      ctx.lineCap     = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();

    } else if (tool === 'blur') {
      const x = Math.max(0, to.x - r * 2);
      const y = Math.max(0, to.y - r * 2);
      const w = Math.min(r * 4, this.base.width  - x);
      const h = Math.min(r * 4, this.base.height - y);
      if (w > 0 && h > 0) {
        const pxData = ctx.getImageData(x, y, w, h);
        const tmp    = Object.assign(document.createElement('canvas'), { width: w, height: h });
        tmp.getContext('2d').putImageData(pxData, 0, 0);
        ctx.save();
        ctx.filter = `blur(${Math.max(2, r * 0.6)}px)`;
        ctx.beginPath(); ctx.arc(to.x, to.y, r, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(tmp, x, y, w, h);
        ctx.restore();
      }

    } else if (tool === 'clone' && this._cloneOffset) {
      const sx = to.x - this._cloneOffset.dx;
      const sy = to.y - this._cloneOffset.dy;
      ctx.save();
      ctx.beginPath(); ctx.arc(to.x, to.y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(this.base, sx - r, sy - r, r * 2, r * 2, to.x - r, to.y - r, r * 2, r * 2);
      ctx.restore();
    }
  }

  _doFill(pt) {
    const { x, y } = { x: Math.round(pt.x), y: Math.round(pt.y) };
    const imgData  = this.ctx.getImageData(0, 0, this.base.width, this.base.height);
    const data     = imgData.data;
    const w        = this.base.width, h = this.base.height;
    const idx      = (y * w + x) * 4;

    // Target color (what we're replacing)
    const tr = data[idx], tg = data[idx + 1], tb = data[idx + 2], ta = data[idx + 3];

    // Fill color
    const fc = hexToRgba(this.toolColor, 1);
    if (tr === fc.r && tg === fc.g && tb === fc.b) return; // already filled

    const TOLERANCE = 32;
    const matches = (i) => Math.abs(data[i] - tr) + Math.abs(data[i+1] - tg) + Math.abs(data[i+2] - tb) < TOLERANCE * 3 && Math.abs(data[i+3] - ta) < TOLERANCE;

    // Flood fill BFS
    const visited = new Uint8Array(w * h);
    const queue   = [x + y * w];
    visited[x + y * w] = 1;

    while (queue.length) {
      const pos = queue.pop();
      const px  = pos % w, py = Math.floor(pos / w);
      const i   = pos * 4;
      data[i] = fc.r; data[i+1] = fc.g; data[i+2] = fc.b; data[i+3] = 255;

      for (const [nx, ny] of [[px-1,py],[px+1,py],[px,py-1],[px,py+1]]) {
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const ni = ny * w + nx;
        if (!visited[ni] && matches(ni * 4)) { visited[ni] = 1; queue.push(ni); }
      }
    }
    this.ctx.putImageData(imgData, 0, 0);
  }

  // ═══════════════════════════════════════════════════
  // SELECTION
  // ═══════════════════════════════════════════════════
  _drawSelectionOverlay() {
    const ctx = this.sCtx;
    ctx.clearRect(0, 0, this.selection.width, this.selection.height);
    if (!this._selRect) return;
    const { x, y, w, h } = this._selRect;
    ctx.save();
    ctx.strokeStyle = '#e63946'; ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(230,57,70,0.08)';
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  clearSelection() {
    this._selRect = null; this._selStart = null;
    this.sCtx.clearRect(0, 0, this.selection.width, this.selection.height);
    if (this.onSelectionChange) this.onSelectionChange(null);
  }

  /** Apply fill/erase to selection rect */
  fillSelection(color = '#ffffff') {
    if (!this._selRect) return;
    this._saveUndo();
    const { x, y, w, h } = this._selRect;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  // ═══════════════════════════════════════════════════
  // DIRECT FILL (for erasing OCR bboxes)
  // ═══════════════════════════════════════════════════
  fillRect(x, y, w, h, color = '#ffffff') {
    this._saveUndo();
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  }

  // ═══════════════════════════════════════════════════
  // OVERLAY (OCR bounding boxes)
  // ═══════════════════════════════════════════════════
  drawOverlay(blocks, selectedId = null) {
    const ctx = this.oCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

    for (const b of blocks) {
      if (!b.visible) continue;
      const { x, y, w, h } = b.bbox;
      const sel     = b.id === selectedId;
      const applied = b.applied;

      ctx.save();
      ctx.strokeStyle = sel ? '#e63946' : applied ? '#2d9e5f' : '#457b9d';
      ctx.lineWidth   = sel ? 2.5 : 1.5;
      ctx.globalAlpha = applied ? 0.35 : 1;
      ctx.setLineDash(sel ? [] : [4, 3]);
      ctx.strokeRect(x + .5, y + .5, w, h);

      ctx.globalAlpha = 1; ctx.setLineDash([]);
      ctx.fillStyle   = sel ? '#e63946' : applied ? '#2d9e5f' : '#457b9d';
      const num = `#${b.id.split('-')[1] ?? '?'}`;
      const tw  = Math.max(ctx.measureText(num).width + 6, 18);
      ctx.fillRect(x, y - 14, tw, 14);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Nunito, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillText(num, x + 3, y);
      ctx.restore();
    }
  }

  clearOverlay() { this.oCtx.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  // ═══════════════════════════════════════════════════
  // UNDO / REDO
  // ═══════════════════════════════════════════════════
  _saveUndo() {
    const snap = this.ctx.getImageData(0, 0, this.base.width, this.base.height);
    this._undoStack.push(snap);
    if (this._undoStack.length > this.MAX_HISTORY) this._undoStack.shift();
    this._redoStack = []; // clear redo on new action
  }

  undo() {
    if (this._undoStack.length < 2) return false;
    this._redoStack.push(this._undoStack.pop());
    this.ctx.putImageData(this._undoStack[this._undoStack.length - 1], 0, 0);
    return true;
  }

  redo() {
    if (!this._redoStack.length) return false;
    const snap = this._redoStack.pop();
    this._undoStack.push(snap);
    this.ctx.putImageData(snap, 0, 0);
    return true;
  }

  // ═══════════════════════════════════════════════════
  // EXPORT
  // ═══════════════════════════════════════════════════
  exportImage(textBoxes) {
    const out = Object.assign(document.createElement('canvas'), {
      width: this.base.width, height: this.base.height
    });
    const oc = out.getContext('2d');
    oc.drawImage(this.base, 0, 0);
    for (const box of textBoxes) renderBoxToCanvas(oc, box);
    return out.toDataURL('image/png');
  }

  // ── Register zoom-change callback ──────────────────
  onZoomChange(cb) { this._zoomCb = cb; }
}

// ═══════════════════════════════════════════════════════
// Render a text-box data object onto a 2D context (shared
// between preview-canvas and final export).
// ═══════════════════════════════════════════════════════
export function renderBoxToCanvas(ctx, box) {
  const { x, y, w, h, text, fontSize, fontFamily, color, bgColor, bgOpacity, align, rotation = 0 } = box;
  if (!text?.trim()) return;

  ctx.save();

  // Apply rotation around the box center
  if (rotation) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // Background
  if (bgOpacity > 0) {
    ctx.globalAlpha = bgOpacity;
    ctx.fillStyle   = bgColor || '#ffffff';
    if (ctx.roundRect) ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 4);
    else               ctx.rect(x - 3, y - 3, w + 6, h + 6);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Text
  ctx.font          = `bold ${fontSize}px '${fontFamily}', sans-serif`;
  ctx.fillStyle     = color || '#000000';
  ctx.textBaseline  = 'top';
  ctx.textAlign     = align || 'center';

  const lineH = fontSize * 1.3;
  const tx    = align === 'right' ? x + w - 5 : align === 'left' ? x + 5 : x + w / 2;
  const wrapped = wrapText(ctx, text, w - 10);

  wrapped.forEach((line, i) => ctx.fillText(line, tx, y + i * lineH + 4));

  ctx.restore();
}

// ── Helpers ───────────────────────────────────────────
function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [text];
}

function normalizeRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function hexToRgba(hex, a = 1) {
  const n = hex.replace('#', '');
  return {
    r: parseInt(n.slice(0, 2), 16),
    g: parseInt(n.slice(2, 4), 16),
    b: parseInt(n.slice(4, 6), 16),
    a,
  };
}
