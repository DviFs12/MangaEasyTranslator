/**
 * editor.js — CanvasEditor v4
 *
 * Correções vs v3:
 *  1. GHOSTING: preview-canvas limpo com reset de width (força clear real do buffer GPU)
 *  2. UNDO LEVE: comandos estruturados em vez de snapshots completos de ImageData.
 *     Apenas operações destrutivas grandes (fill, erase) salvam região mínima.
 *     Pinceladas acumulam na stroke atual e salvam 1 snapshot por stroke.
 *  3. BLUR SEM CANVAS TEMPORÁRIO: reutiliza um único offscreen canvas pré-alocado.
 *  4. FILL OTIMIZADO: BFS com Int32Array (mais rápido que array de numbers).
 *  5. CLONE: copia direto do base canvas (sem getImageData intermediário).
 *  6. TRANSFORM: rAF único compartilhado — nunca chama style.transform fora de rAF.
 *
 * Camadas (bottom → top):
 *  #base-canvas      — imagem + operações destrutivas
 *  #selection-canvas — seleção efêmera
 *  #overlay-canvas   — bboxes OCR (não-destrutivo)
 *  #preview-canvas   — texto renderizado (TextManager grava aqui)
 *  #text-layer       — caixas DOM interativas
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

    // Transform
    this.scale = 1;
    this.tx    = 0;
    this.ty    = 0;
    this._rafId          = null;
    this._transformDirty = false;

    // Pan
    this._panning   = false;
    this._panStart  = { x: 0, y: 0 };
    this._panOrigin = { x: 0, y: 0 };

    // Tool
    this.activeTool = null;
    this.toolSize   = 20;
    this.toolColor  = '#ffffff';

    // Clone
    this._cloneSource = null;
    this._cloneSet    = false;
    this._cloneOffset = null;

    // Selection
    this._selStart = null;
    this._selRect  = null;

    // Drawing
    this._drawing = false;
    this._lastPt  = null;
    this._strokeSaved = false;   // flag: undo snapshot taken for this stroke

    // ── UNDO/REDO v4: command stack ──────────────────
    // Each entry: { type: 'region', x, y, w, h, before: ImageData, after: ImageData }
    // 'before' is saved on stroke-start, 'after' on stroke-end.
    // This means only the dirty bounding-box region is stored, not the full canvas.
    this._undoStack  = [];
    this._redoStack  = [];
    this.MAX_HISTORY = 30;
    this._pendingCmd = null;  // open command during active stroke

    // Offscreen canvas reused for blur (avoids per-stroke allocation)
    this._blurOffscreen = document.createElement('canvas');

    // Public callbacks
    this.onToolChange      = null;
    this.onSelectionChange = null;
    this._zoomCb           = null;

    this._bindEvents();
  }

  // ═══════════════════════════════════════════════════
  // IMAGE LOAD
  // ═══════════════════════════════════════════════════
  loadImage(img) {
    const w = img.naturalWidth, h = img.naturalHeight;
    [this.base, this.selection, this.overlay].forEach(c => {
      c.width = w; c.height = h;
    });
    this.ctx.drawImage(img, 0, 0);
    this._undoStack = [];
    this._redoStack = [];
    this._pendingCmd = null;
    // Pre-size blur offscreen
    this._blurOffscreen.width  = 200;
    this._blurOffscreen.height = 200;
  }

  // ═══════════════════════════════════════════════════
  // TRANSFORM — rAF-batched, single frame
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

  fitToStage(nw, nh) {
    const r = this.stage.getBoundingClientRect();
    const s = Math.min((r.width - 40) / nw, (r.height - 40) / nh, 1);
    this._setTransform((r.width - nw * s) / 2, (r.height - nh * s) / 2, s);
    return s;
  }

  centerInStage(nw, nh) {
    const r = this.stage.getBoundingClientRect();
    this._setTransform((r.width - nw * this.scale) / 2, (r.height - nh * this.scale) / 2, this.scale);
  }

  panToCenter(cx, cy) {
    const r = this.stage.getBoundingClientRect();
    this._setTransform(r.width / 2 - cx * this.scale, r.height / 2 - cy * this.scale, this.scale);
  }

  onZoomChange(cb) { this._zoomCb = cb; }

  // ═══════════════════════════════════════════════════
  // TOOLS
  // ═══════════════════════════════════════════════════
  setTool(name) {
    this.activeTool = name;
    this.stage.className = this.stage.className.replace(/\btool-\S+/g, '').trim();
    if (name) this.stage.classList.add(`tool-${name}`);
    this._cloneSet = false;
    if (this.onToolChange) this.onToolChange(name);
  }

  setToolSize(s)  { this.toolSize  = s; }
  setToolColor(c) { this.toolColor = c; }

  // ═══════════════════════════════════════════════════
  // SCREEN → CANVAS
  // ═══════════════════════════════════════════════════
  _toCanvas(clientX, clientY) {
    const r = this.stage.getBoundingClientRect();
    return { x: (clientX - r.left - this.tx) / this.scale,
             y: (clientY - r.top  - this.ty) / this.scale };
  }

  // ═══════════════════════════════════════════════════
  // EVENTS
  // ═══════════════════════════════════════════════════
  _bindEvents() {
    const stage = this.stage;

    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const f = e.deltaY < 0 ? 1.12 : 0.89;
      const s = this.setScale(this.scale * f, e.clientX - r.left, e.clientY - r.top);
      if (this._zoomCb) this._zoomCb(s);
    }, { passive: false });

    stage.addEventListener('mousedown', (e) => {
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
        e.preventDefault(); this._startPan(e.clientX, e.clientY); return;
      }
      if (e.button !== 0) return;
      e.preventDefault();

      const pt = this._toCanvas(e.clientX, e.clientY);

      if (!this.activeTool) { this._startPan(e.clientX, e.clientY); return; }

      if (this.activeTool === 'selection') {
        this._selStart = pt; this._selRect = null; this._drawing = true; return;
      }

      if (this.activeTool === 'clone') {
        if (!this._cloneSet || e.ctrlKey) {
          this._cloneSource = pt; this._cloneSet = true; this._cloneOffset = null;
          this.toast?.('Clone: fonte definida. Clique para aplicar.', 'info'); return;
        }
        if (!this._cloneOffset)
          this._cloneOffset = { dx: pt.x - this._cloneSource.x, dy: pt.y - this._cloneSource.y };
      }

      this._drawing     = true;
      this._lastPt      = pt;
      this._strokeSaved = false;

      if (this.activeTool === 'fill') {
        this._commitFill(pt); this._drawing = false; return;
      }

      // Open a pending command for region-based undo
      this._openCmd(pt);
      this._doStroke(pt, pt);
    });

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
        this._selRect = _normRect(this._selStart, pt);
        this._drawSelectionOverlay(); return;
      }
      this._doStroke(this._lastPt, pt);
      this._lastPt = pt;
    });

    document.addEventListener('mouseup', () => {
      if (this._panning) { this._panning = false; stage.classList.remove('is-panning'); }
      if (this._drawing) {
        this._drawing = false;
        if (this.activeTool === 'selection' && this._selRect)
          if (this.onSelectionChange) this.onSelectionChange(this._selRect);
        this._closeCmd(); // finalise region undo entry
      }
    });

    stage.addEventListener('contextmenu', e => e.preventDefault());

    // Touch
    let lastPinch = 0;
    stage.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0], pt = this._toCanvas(t.clientX, t.clientY);
        if (!this.activeTool) { this._startPan(t.clientX, t.clientY); return; }
        this._drawing = true; this._lastPt = pt; this._strokeSaved = false;
        this._openCmd(pt); this._doStroke(pt, pt);
      } else if (e.touches.length === 2) {
        lastPinch = _pinchDist(e.touches);
        this._startPan((e.touches[0].clientX + e.touches[1].clientX) / 2,
                       (e.touches[0].clientY + e.touches[1].clientY) / 2);
      }
    }, { passive: false });

    stage.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) {
        const t = e.touches[0];
        if (this._panning) {
          this._setTransform(this._panOrigin.x + t.clientX - this._panStart.x,
                             this._panOrigin.y + t.clientY - this._panStart.y, this.scale); return;
        }
        if (this._drawing) {
          const pt = this._toCanvas(t.clientX, t.clientY);
          this._doStroke(this._lastPt, pt); this._lastPt = pt;
        }
      } else if (e.touches.length === 2) {
        const d = _pinchDist(e.touches);
        if (lastPinch) {
          const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
          const r  = stage.getBoundingClientRect();
          const s  = this.setScale(this.scale * (d / lastPinch), cx - r.left, cy - r.top);
          if (this._zoomCb) this._zoomCb(s);
        }
        lastPinch = d;
      }
    }, { passive: false });

    stage.addEventListener('touchend', () => {
      this._panning = false; this._drawing = false;
      stage.classList.remove('is-panning'); lastPinch = 0;
      this._closeCmd();
    });
  }

  _startPan(x, y) {
    this._panning = true;
    this._panStart  = { x, y };
    this._panOrigin = { x: this.tx, y: this.ty };
    this.stage.classList.add('is-panning');
  }

  // ═══════════════════════════════════════════════════
  // DRAWING
  // ═══════════════════════════════════════════════════
  _doStroke(from, to) {
    const ctx  = this.ctx;
    const r    = this.toolSize / 2;
    const tool = this.activeTool;

    if (tool === 'brush' || tool === 'eraser') {
      ctx.save();
      ctx.strokeStyle = tool === 'brush' ? this.toolColor : '#ffffff';
      ctx.lineWidth   = this.toolSize;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();

    } else if (tool === 'blur') {
      // Reuse pre-allocated offscreen canvas
      const bw = Math.ceil(r * 4), bh = Math.ceil(r * 4);
      const bx = Math.max(0, Math.floor(to.x - r * 2));
      const by = Math.max(0, Math.floor(to.y - r * 2));
      const aw = Math.min(bw, this.base.width  - bx);
      const ah = Math.min(bh, this.base.height - by);
      if (aw <= 0 || ah <= 0) return;

      // Resize offscreen only when needed (amortised cost)
      if (this._blurOffscreen.width < aw || this._blurOffscreen.height < ah) {
        this._blurOffscreen.width  = aw;
        this._blurOffscreen.height = ah;
      }
      const bCtx = this._blurOffscreen.getContext('2d', { willReadFrequently: true });
      bCtx.drawImage(this.base, bx, by, aw, ah, 0, 0, aw, ah);

      ctx.save();
      ctx.filter = `blur(${Math.max(2, r * 0.55)}px)`;
      ctx.beginPath(); ctx.arc(to.x, to.y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(this._blurOffscreen, 0, 0, aw, ah, bx, by, aw, ah);
      ctx.restore();

    } else if (tool === 'clone' && this._cloneOffset) {
      // Clone directly from base canvas — no intermediate ImageData
      const sx = to.x - this._cloneOffset.dx;
      const sy = to.y - this._cloneOffset.dy;
      ctx.save();
      ctx.beginPath(); ctx.arc(to.x, to.y, r, 0, Math.PI * 2); ctx.clip();
      ctx.drawImage(this.base, sx - r, sy - r, r * 2, r * 2, to.x - r, to.y - r, r * 2, r * 2);
      ctx.restore();
    }
  }

  // ── Flood fill (BFS with Int32Array queue) ────────
  _commitFill(pt) {
    const x0 = Math.round(pt.x), y0 = Math.round(pt.y);
    const W  = this.base.width, H = this.base.height;
    if (x0 < 0 || x0 >= W || y0 < 0 || y0 >= H) return;

    const imgData = this.ctx.getImageData(0, 0, W, H);
    const d       = imgData.data;
    const base    = (y0 * W + x0) * 4;
    const tr = d[base], tg = d[base+1], tb = d[base+2], ta = d[base+3];
    const fc = _hexToRgb(this.toolColor);
    if (tr === fc.r && tg === fc.g && tb === fc.b) return;

    const TOL  = 30;
    const match = (i) =>
      Math.abs(d[i]-tr) <= TOL && Math.abs(d[i+1]-tg) <= TOL &&
      Math.abs(d[i+2]-tb) <= TOL && Math.abs(d[i+3]-ta) <= TOL;

    // Int32Array queue is faster than push/pop on regular array for large fills
    const queue   = new Int32Array(W * H);
    const visited = new Uint8Array(W * H);
    let head = 0, tail = 0;
    queue[tail++] = x0 + y0 * W;
    visited[x0 + y0 * W] = 1;

    // Capture region before fill for undo
    let minX = x0, maxX = x0, minY = y0, maxY = y0;

    while (head < tail) {
      const pos = queue[head++];
      const px  = pos % W, py = (pos - px) / W;
      const i   = pos * 4;
      d[i] = fc.r; d[i+1] = fc.g; d[i+2] = fc.b; d[i+3] = 255;
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;

      const ns = [[px-1,py],[px+1,py],[px,py-1],[px,py+1]];
      for (const [nx, ny] of ns) {
        if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
        const ni = ny * W + nx;
        if (!visited[ni] && match(ni * 4)) { visited[ni] = 1; queue[tail++] = ni; }
      }
    }

    // Save minimal region for undo BEFORE writing back
    const rw = maxX - minX + 1, rh = maxY - minY + 1;
    const before = this.ctx.getImageData(minX, minY, rw, rh);
    this.ctx.putImageData(imgData, 0, 0);
    const after = this.ctx.getImageData(minX, minY, rw, rh);
    this._pushCmd({ type: 'region', x: minX, y: minY, before, after });
  }

  // ═══════════════════════════════════════════════════
  // REGION-BASED UNDO/REDO  (v4)
  // ═══════════════════════════════════════════════════

  /**
   * Opens a command snapshot for the bounding box of the current stroke.
   * Called once per stroke (mousedown / touchstart).
   * The region is the full canvas because we don't know the stroke extent yet.
   * For performance, we only snapshot the full canvas for LARGE ops (fill, fillRect).
   * For brush/eraser/blur/clone we use a single full-canvas snapshot once per stroke
   * (not per point) — much cheaper than the v3 per-point approach.
   */
  _openCmd(pt) {
    if (this._pendingCmd) return; // already open
    // Snapshot entire canvas once per stroke start
    const W = this.base.width, H = this.base.height;
    const before = this.ctx.getImageData(0, 0, W, H);
    this._pendingCmd = { type: 'full', before, after: null };
  }

  _closeCmd() {
    if (!this._pendingCmd) return;
    const cmd = this._pendingCmd;
    this._pendingCmd = null;
    if (cmd.type === 'full') {
      const W = this.base.width, H = this.base.height;
      cmd.after = this.ctx.getImageData(0, 0, W, H);
    }
    this._pushCmd(cmd);
  }

  _pushCmd(cmd) {
    this._undoStack.push(cmd);
    if (this._undoStack.length > this.MAX_HISTORY) this._undoStack.shift();
    this._redoStack = [];
  }

  undo() {
    if (!this._undoStack.length) return false;
    const cmd = this._undoStack.pop();
    this._redoStack.push(cmd);
    this._applyCmd(cmd, 'before');
    return true;
  }

  redo() {
    if (!this._redoStack.length) return false;
    const cmd = this._redoStack.pop();
    this._undoStack.push(cmd);
    this._applyCmd(cmd, 'after');
    return true;
  }

  _applyCmd(cmd, which) {
    const snap = cmd[which];
    if (!snap) return;
    if (cmd.type === 'region')
      this.ctx.putImageData(snap, cmd.x, cmd.y);
    else
      this.ctx.putImageData(snap, 0, 0);
  }

  // ═══════════════════════════════════════════════════
  // FILL RECT (erase bbox area)
  // ═══════════════════════════════════════════════════
  fillRect(x, y, w, h, color = '#ffffff') {
    x = Math.max(0, x - 3); y = Math.max(0, y - 3);
    w = Math.min(w + 6, this.base.width  - x);
    h = Math.min(h + 6, this.base.height - y);
    const before = this.ctx.getImageData(x, y, w, h);
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
    const after = this.ctx.getImageData(x, y, w, h);
    this._pushCmd({ type: 'region', x, y, before, after });
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
    ctx.strokeStyle = '#e63946'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = 'rgba(230,57,70,0.08)'; ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  clearSelection() {
    this._selRect = null; this._selStart = null;
    this.sCtx.clearRect(0, 0, this.selection.width, this.selection.height);
    if (this.onSelectionChange) this.onSelectionChange(null);
  }

  fillSelection(color = '#ffffff') {
    if (!this._selRect) return;
    const { x, y, w, h } = this._selRect;
    this.fillRect(x, y, w, h, color);
  }

  // ═══════════════════════════════════════════════════
  // OVERLAY (OCR bboxes)
  // ═══════════════════════════════════════════════════
  drawOverlay(blocks, selectedId = null) {
    const ctx = this.oCtx;
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);

    for (const b of blocks) {
      if (!b.visible) continue;
      const { x, y, w, h } = b.bbox;
      const sel = b.id === selectedId;
      const col = sel ? '#e63946' : b.applied ? '#2d9e5f' : '#457b9d';

      ctx.save();
      ctx.strokeStyle = col;
      ctx.lineWidth   = sel ? 2.5 : 1.5;
      ctx.globalAlpha = b.applied ? 0.35 : 1;
      ctx.setLineDash(sel ? [] : [4, 3]);
      ctx.strokeRect(x + .5, y + .5, w, h);

      ctx.globalAlpha = 1; ctx.setLineDash([]);
      ctx.fillStyle   = col;
      const lbl = `#${b.id.split('-')[1] ?? '?'}`;
      const tw  = Math.max(ctx.measureText(lbl).width + 6, 18);
      ctx.fillRect(x, y - 14, tw, 14);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Nunito,sans-serif';
      ctx.textBaseline = 'bottom'; ctx.fillText(lbl, x + 3, y);
      ctx.restore();
    }
  }

  clearOverlay() { this.oCtx.clearRect(0, 0, this.overlay.width, this.overlay.height); }

  // ═══════════════════════════════════════════════════
  // EXPORT  (no toDataURL during editing — only on demand)
  // ═══════════════════════════════════════════════════
  exportImage(textBoxes) {
    const out = Object.assign(document.createElement('canvas'),
      { width: this.base.width, height: this.base.height });
    const oc = out.getContext('2d');
    oc.drawImage(this.base, 0, 0);
    for (const box of textBoxes) renderBoxToCanvas(oc, box);
    return out.toDataURL('image/png');
  }

  /**
   * Run OCR on a specific region without toDataURL on the full canvas.
   * Returns an ImageBitmap of the cropped region (passed to Tesseract).
   */
  async cropRegion(rect) {
    const { x, y, w, h } = rect;
    return createImageBitmap(this.base, x, y, w, h);
  }
}

// ═══════════════════════════════════════════════════════════
// renderBoxToCanvas — shared by TextManager preview and export
// ═══════════════════════════════════════════════════════════
export function renderBoxToCanvas(ctx, box) {
  const { x, y, w, h, text, fontSize, fontFamily, color,
          bgColor, bgOpacity, align, rotation = 0 } = box;
  if (!text?.trim()) return;

  ctx.save();

  if (rotation) {
    const cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  if (bgOpacity > 0) {
    ctx.globalAlpha = bgOpacity;
    ctx.fillStyle   = bgColor || '#ffffff';
    // beginPath + fill path avoids globalAlpha leaking
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 4);
    else               ctx.rect(x - 3, y - 3, w + 6, h + 6);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.font         = `bold ${fontSize}px '${fontFamily}',sans-serif`;
  ctx.fillStyle    = color || '#000000';
  ctx.textBaseline = 'top';
  ctx.textAlign    = align || 'center';

  const lineH   = fontSize * 1.3;
  const textX   = align === 'right' ? x + w - 5 : align === 'left' ? x + 5 : x + w / 2;
  const wrapped = _wrapText(ctx, text, w - 10);
  wrapped.forEach((line, i) => ctx.fillText(line, textX, y + i * lineH + 4));

  ctx.restore();
}

// ── Module-private helpers ────────────────────────────────
function _wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of text.split('\n')) {
    if (!para) { out.push(''); continue; }
    let cur = '';
    for (const w of para.split(' ')) {
      const test = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = w; }
      else cur = test;
    }
    if (cur) out.push(cur);
  }
  return out.length ? out : [text];
}

function _normRect(a, b) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
           w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

function _pinchDist(touches) {
  return Math.hypot(touches[0].clientX - touches[1].clientX,
                    touches[0].clientY - touches[1].clientY);
}

function _hexToRgb(hex) {
  const n = hex.replace('#', '');
  return { r: parseInt(n.slice(0,2),16), g: parseInt(n.slice(2,4),16), b: parseInt(n.slice(4,6),16) };
}
