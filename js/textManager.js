/**
 * textManager.js — Gerencia caixas de texto DOM sobre o canvas.
 *
 * Features:
 *  • Drag, resize (SE + S), rotate (handle superior)
 *  • Live preview em #preview-canvas via requestAnimationFrame
 *  • Não freezes: preview é debounced e usa rAF
 *  • Dados separados do DOM (source of truth = this.boxes Map)
 */

import { renderBoxToCanvas } from './editor.js';

export class TextManager {
  constructor(textLayer, previewCanvas) {
    this.textLayer     = textLayer;
    this.previewCanvas = previewCanvas;
    this.pCtx          = previewCanvas.getContext('2d');

    this.boxes      = new Map();   // id → { el, data }
    this.selectedId = null;

    // Callbacks
    this.onSelect   = null;  // (id, data) => void
    this.onDeselect = null;  // () => void

    // rAF preview
    this._previewDirty = false;
    this._rafId        = null;

    // Deselect when clicking outside
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.text-box') &&
          !e.target.closest('#box-editor') &&
          !e.target.closest('#panel-right')) {
        this.deselect();
      }
    });
  }

  // ═══════════════════════════════════════════════════
  // ADD BOX
  // ═══════════════════════════════════════════════════
  add(opts) {
    const data = {
      id:         opts.id ?? `box-${Date.now()}`,
      text:       opts.text       ?? '',
      x:          opts.x          ?? 50,
      y:          opts.y          ?? 50,
      w:          opts.w          ?? 140,
      h:          opts.h          ?? null,   // auto if null
      fontSize:   opts.fontSize   ?? 18,
      fontFamily: opts.fontFamily ?? 'Bangers',
      color:      opts.color      ?? '#000000',
      bgColor:    opts.bgColor    ?? '#ffffff',
      bgOpacity:  opts.bgOpacity  ?? 0.9,
      align:      opts.align      ?? 'center',
      rotation:   opts.rotation   ?? 0,
    };
    data.h = data.h ?? this._estimateH(data);

    if (this.boxes.has(data.id)) this.remove(data.id);

    const el = this._buildElement(data);
    this.textLayer.appendChild(el);
    this.boxes.set(data.id, { el, data });

    this._schedulePreview();
    this.select(data.id);
    return data;
  }

  // ═══════════════════════════════════════════════════
  // BUILD DOM ELEMENT
  // ═══════════════════════════════════════════════════
  _buildElement(data) {
    const el = document.createElement('div');
    el.className  = 'text-box';
    el.id         = `tb-${data.id}`;

    this._applyStyles(el, data);

    // Text span
    const span = document.createElement('span');
    span.className = 'tb-text';
    el.appendChild(span);

    // Controls
    el.appendChild(this._makeHandle('tb-delete',    '×', 'mousedown', () => this.remove(data.id)));
    el.appendChild(this._makeHandle('tb-resize-se', '',  'mousedown', (e) => this._resizeSE(e, data.id)));
    el.appendChild(this._makeHandle('tb-resize-s',  '',  'mousedown', (e) => this._resizeS(e, data.id)));
    el.appendChild(this._makeHandle('tb-rotate',    '↻', 'mousedown', (e) => this._startRotate(e, data.id)));

    this._applyContent(el, data);

    el.addEventListener('mousedown', (e) => {
      if (['tb-resize-se','tb-resize-s','tb-rotate','tb-delete'].some(c => e.target.classList.contains(c))) return;
      e.stopPropagation();
      this.select(data.id);
      this._startDrag(e, data.id);
    });

    el.addEventListener('dblclick', () => {
      this.select(data.id);
      const ta = document.getElementById('box-text');
      if (ta) { ta.focus(); ta.select(); }
    });

    return el;
  }

  _makeHandle(cls, text, evt, handler) {
    const h = document.createElement('div');
    h.className = cls;
    if (text) h.textContent = text;
    h.addEventListener(evt, (e) => { e.stopPropagation(); handler(e); });
    return h;
  }

  _applyStyles(el, data) {
    el.style.cssText = `
      left: ${data.x}px; top: ${data.y}px;
      width: ${data.w}px; min-height: ${data.h}px;
      font-size: ${data.fontSize}px;
      font-family: '${data.fontFamily}', sans-serif;
      color: ${data.color};
      background-color: ${rgba(data.bgColor, data.bgOpacity)};
      text-align: ${data.align};
      transform: rotate(${data.rotation}deg);
      transform-origin: center center;
      white-space: pre-wrap;
    `;
  }

  _applyContent(el, data) {
    const span = el.querySelector('.tb-text');
    if (span) span.textContent = data.text;
  }

  // ═══════════════════════════════════════════════════
  // UPDATE / SELECT / REMOVE
  // ═══════════════════════════════════════════════════
  update(id, patch) {
    const box = this.boxes.get(id);
    if (!box) return;
    Object.assign(box.data, patch);
    if ('text' in patch || 'fontSize' in patch || 'w' in patch) {
      box.data.h = this._estimateH(box.data);
    }
    this._applyStyles(box.el, box.data);
    this._applyContent(box.el, box.data);
    if (box.el.classList.contains('selected')) box.el.classList.add('selected'); // keep
    this._schedulePreview();
  }

  updateSelected(patch) {
    if (this.selectedId) this.update(this.selectedId, patch);
  }

  select(id) {
    if (this.selectedId && this.selectedId !== id) {
      this.boxes.get(this.selectedId)?.el.classList.remove('selected');
    }
    this.selectedId = id;
    const box = this.boxes.get(id);
    if (box) {
      box.el.classList.add('selected');
      if (this.onSelect) this.onSelect(id, { ...box.data });
    }
  }

  deselect() {
    if (!this.selectedId) return;
    this.boxes.get(this.selectedId)?.el.classList.remove('selected');
    this.selectedId = null;
    if (this.onDeselect) this.onDeselect();
  }

  remove(id) {
    const box = this.boxes.get(id);
    if (!box) return;
    box.el.remove();
    this.boxes.delete(id);
    if (this.selectedId === id) { this.selectedId = null; if (this.onDeselect) this.onDeselect(); }
    this._schedulePreview();
  }

  clear() { [...this.boxes.keys()].forEach(id => this.remove(id)); }

  getAllData() { return [...this.boxes.values()].map(b => ({ ...b.data })); }

  // ═══════════════════════════════════════════════════
  // LIVE PREVIEW  (rAF-debounced, never blocks UI)
  // ═══════════════════════════════════════════════════
  _schedulePreview() {
    this._previewDirty = true;
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      if (!this._previewDirty) return;
      this._previewDirty = false;
      this._renderPreview();
    });
  }

  _renderPreview() {
    const pc  = this.previewCanvas;
    if (!pc.width || !pc.height) return;
    this.pCtx.clearRect(0, 0, pc.width, pc.height);
    for (const { data } of this.boxes.values()) {
      renderBoxToCanvas(this.pCtx, data);
    }
  }

  syncPreviewSize(w, h) {
    if (this.previewCanvas.width !== w || this.previewCanvas.height !== h) {
      this.previewCanvas.width  = w;
      this.previewCanvas.height = h;
    }
  }

  // ═══════════════════════════════════════════════════
  // DRAG
  // ═══════════════════════════════════════════════════
  _startDrag(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { data } = box;
    let sx = e.clientX, sy = e.clientY;
    let ox = data.x,    oy = data.y;

    const onMove = (ev) => {
      data.x = ox + ev.clientX - sx;
      data.y = oy + ev.clientY - sy;
      box.el.style.left = `${data.x}px`;
      box.el.style.top  = `${data.y}px`;
      this._schedulePreview();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ═══════════════════════════════════════════════════
  // RESIZE SE (width)
  // ═══════════════════════════════════════════════════
  _resizeSE(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { data } = box;
    let sx = e.clientX, sw = data.w;
    const onMove = (ev) => {
      data.w = Math.max(50, sw + ev.clientX - sx);
      box.el.style.width = `${data.w}px`;
      this._schedulePreview();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ═══════════════════════════════════════════════════
  // RESIZE S (height)
  // ═══════════════════════════════════════════════════
  _resizeS(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { data } = box;
    let sy = e.clientY, sh = data.h;
    const onMove = (ev) => {
      data.h = Math.max(20, sh + ev.clientY - sy);
      box.el.style.minHeight = `${data.h}px`;
      this._schedulePreview();
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ═══════════════════════════════════════════════════
  // ROTATE
  // ═══════════════════════════════════════════════════
  _startRotate(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { el, data } = box;
    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;

    const onMove = (ev) => {
      const angle = Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI) + 90;
      data.rotation = Math.round(angle);
      el.style.transform       = `rotate(${data.rotation}deg)`;
      el.style.transformOrigin = 'center center';
      this._schedulePreview();
      // Update panel
      const inp = document.getElementById('box-rotation');
      const val = document.getElementById('box-rotation-val');
      if (inp) inp.value = data.rotation;
      if (val) val.textContent = data.rotation;
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ═══════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════
  _estimateH(data) {
    const { text, fontSize, w } = data;
    const lines = text.split('\n');
    const cpp   = Math.max(1, Math.floor(w / (fontSize * 0.58)));
    let total   = 0;
    for (const l of lines) total += Math.max(1, Math.ceil(l.length / cpp));
    return Math.max(fontSize * 1.5, total * fontSize * 1.35 + 12);
  }
}

function rgba(hex, a) {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${a})`;
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
}
