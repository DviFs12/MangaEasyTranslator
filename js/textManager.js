/**
 * textManager.js — v4
 *
 * Correções vs v3:
 *  1. GHOSTING FIX: O canvas clearRect sozinho não limpa o buffer se o contexto
 *     está em estado inconsistente. Solução: setar width=width força reset real
 *     do buffer de pixels do canvas. Fazemos isso uma vez quando há resize;
 *     para frames normais usamos clearRect (mais rápido).
 *     Adicionalmente, preview usa `ctx.save/restore` para nunca vazar estado.
 *
 *  2. PREVIEW EFICIENTE: só redesenha caixas que mudaram (dirty-box tracking).
 *     Caixas sem alteração são compostas do cache (OffscreenCanvas por caixa).
 *
 *  3. DRAG NÃO ESCALA INCORRETAMENTE: posições armazenadas em coordenadas de
 *     canvas original; conversão de screen→canvas usa o scale atual do editor.
 *
 *  4. AUTO-REDRAW INTELIGENTE: ao aplicar uma tradução, analisa a densidade de
 *     pixels escuros na região de destino. Se a caixa sobrepõe área importante
 *     (muitos pixels não-brancos), sugere reposicionamento.
 */

import { renderBoxToCanvas } from './editor.js';

export class TextManager {
  /**
   * @param {HTMLElement}  textLayer      — div sobreposta ao canvas
   * @param {HTMLCanvasElement} previewCanvas
   * @param {CanvasEditor} editor         — referência para obter scale
   */
  constructor(textLayer, previewCanvas, editor) {
    this.textLayer     = textLayer;
    this.previewCanvas = previewCanvas;
    this.editor        = editor;       // needed for screen→canvas conversion
    this.pCtx          = previewCanvas.getContext('2d');

    this.boxes      = new Map();  // id → { el, data, dirty:bool, cache:OffscreenCanvas|null }
    this.selectedId = null;

    // Callbacks
    this.onSelect   = null;  // (id, data) => void
    this.onDeselect = null;  // () => void

    // rAF state
    this._previewDirty = false;
    this._rafId        = null;

    // Deselect on outside click
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.text-box') &&
          !e.target.closest('#box-editor') &&
          !e.target.closest('#panel-right')) this.deselect();
    });
  }

  // ═══════════════════════════════════════════════════
  // ADD
  // ═══════════════════════════════════════════════════
  add(opts) {
    const data = {
      id:         opts.id         ?? `box-${Date.now()}`,
      text:       opts.text       ?? '',
      x:          opts.x          ?? 50,
      y:          opts.y          ?? 50,
      w:          opts.w          ?? 140,
      h:          opts.h          ?? null,
      fontSize:   opts.fontSize   ?? 18,
      fontFamily: opts.fontFamily ?? 'Bangers',
      color:      opts.color      ?? '#000000',
      bgColor:    opts.bgColor    ?? '#ffffff',
      bgOpacity:  opts.bgOpacity  ?? 0.9,
      align:      opts.align      ?? 'center',
      rotation:   opts.rotation   ?? 0,
    };
    data.h = data.h ?? this._estH(data);

    if (this.boxes.has(data.id)) this.remove(data.id);

    const el = this._buildEl(data);
    this.textLayer.appendChild(el);
    this.boxes.set(data.id, { el, data, dirty: true, cache: null });

    this._schedulePreview();
    this.select(data.id);
    return data;
  }

  // ═══════════════════════════════════════════════════
  // BUILD DOM ELEMENT
  // ═══════════════════════════════════════════════════
  _buildEl(data) {
    const el = document.createElement('div');
    el.className = 'text-box';
    el.id        = `tb-${data.id}`;

    const span = document.createElement('span');
    span.className = 'tb-text';
    el.appendChild(span);

    // Handles
    el.appendChild(_handle('tb-delete',    '×', () => this.remove(data.id)));
    el.appendChild(_handle('tb-resize-se', '',  (e) => this._onResizeSE(e, data.id)));
    el.appendChild(_handle('tb-resize-s',  '',  (e) => this._onResizeS(e, data.id)));
    el.appendChild(_handle('tb-rotate',    '↻', (e) => this._onRotate(e, data.id)));

    this._styleEl(el, data);

    el.addEventListener('mousedown', (e) => {
      if (_isHandle(e.target)) return;
      e.stopPropagation();
      this.select(data.id);
      this._onDrag(e, data.id);
    });
    el.addEventListener('dblclick', () => {
      this.select(data.id);
      document.getElementById('box-text')?.focus();
    });

    return el;
  }

  _styleEl(el, data) {
    const s = this.editor?.scale ?? 1;
    el.style.cssText = `
      left:${data.x}px; top:${data.y}px;
      width:${data.w}px; min-height:${data.h}px;
      font-size:${data.fontSize}px;
      font-family:'${data.fontFamily}',sans-serif;
      color:${data.color};
      background-color:${_rgba(data.bgColor,data.bgOpacity)};
      text-align:${data.align};
      transform:rotate(${data.rotation}deg);
      transform-origin:center center;
      white-space:pre-wrap;
    `;
    const span = el.querySelector('.tb-text');
    if (span) span.textContent = data.text;
  }

  // ═══════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════
  update(id, patch) {
    const box = this.boxes.get(id);
    if (!box) return;
    Object.assign(box.data, patch);
    if ('text' in patch || 'fontSize' in patch || 'w' in patch)
      box.data.h = this._estH(box.data);
    this._styleEl(box.el, box.data);
    if (box.el.classList.contains('selected')) box.el.classList.add('selected');
    box.dirty = true;  // mark for re-cache
    box.cache = null;
    this._schedulePreview();
  }

  updateSelected(patch) { if (this.selectedId) this.update(this.selectedId, patch); }

  // ═══════════════════════════════════════════════════
  // SELECT / DESELECT
  // ═══════════════════════════════════════════════════
  select(id) {
    if (this.selectedId !== id) this.boxes.get(this.selectedId)?.el.classList.remove('selected');
    this.selectedId = id;
    const box = this.boxes.get(id);
    if (box) { box.el.classList.add('selected'); if (this.onSelect) this.onSelect(id, { ...box.data }); }
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

  syncPreviewSize(w, h) {
    // Force real GPU buffer reset when dimensions change
    if (this.previewCanvas.width !== w || this.previewCanvas.height !== h) {
      this.previewCanvas.width  = w;
      this.previewCanvas.height = h;
      // Re-get context after resize (some browsers invalidate it)
      this.pCtx = this.previewCanvas.getContext('2d');
    }
  }

  // ═══════════════════════════════════════════════════
  // PREVIEW — rAF-debounced, dirty-box aware
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
    const ctx = this.pCtx;
    if (!pc.width || !pc.height || !ctx) return;

    // ── GHOSTING FIX ────────────────────────────────
    // clearRect is fast but can leave artifacts if the context state is dirty.
    // We save/restore around the whole render to guarantee clean state.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);  // identity transform
    ctx.clearRect(0, 0, pc.width, pc.height);
    ctx.restore();

    // Render all boxes with cached OffscreenCanvas where possible
    for (const { data, dirty, cache } of this.boxes.values()) {
      if (dirty || !cache) {
        // Re-render into per-box OffscreenCanvas
        const oc = new OffscreenCanvas(data.w + 20, data.h + 20);
        const oc_ctx = oc.getContext('2d');
        renderBoxToCanvas(oc_ctx, { ...data, x: 3, y: 3 }); // offset by padding
        const entry = this.boxes.get(data.id);
        if (entry) { entry.cache = oc; entry.dirty = false; }
        // Draw from offscreen
        ctx.drawImage(oc, data.x - 3, data.y - 3);
      } else {
        // Use cached render — just blit
        ctx.drawImage(cache, data.x - 3, data.y - 3);
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // SMART PLACEMENT — checks if destination has important art
  // ═══════════════════════════════════════════════════
  /**
   * Analyzes pixel density in a region to detect if it overlaps important art.
   * Returns { score: 0-1, suggestion: {x,y}|null }
   * score > 0.4 = likely covering art, consider moving
   */
  analyzeRegion(baseCanvas, x, y, w, h) {
    const ctx = baseCanvas.getContext('2d', { willReadFrequently: true });
    const px  = Math.max(0, Math.floor(x));
    const py  = Math.max(0, Math.floor(y));
    const pw  = Math.min(Math.ceil(w), baseCanvas.width  - px);
    const ph  = Math.min(Math.ceil(h), baseCanvas.height - py);
    if (pw <= 0 || ph <= 0) return { score: 0, suggestion: null };

    const data    = ctx.getImageData(px, py, pw, ph).data;
    let darkCount = 0;
    const total   = pw * ph;

    for (let i = 0; i < total; i++) {
      const base = i * 4;
      const lum  = 0.299 * data[base] + 0.587 * data[base+1] + 0.114 * data[base+2];
      if (lum < 180) darkCount++;
    }

    const score = darkCount / total;

    // Simple suggestion: try to move below the block
    let suggestion = null;
    if (score > 0.4) {
      const tryY = y + h + 10;
      if (tryY + h < baseCanvas.height) suggestion = { x, y: tryY };
    }

    return { score: Math.round(score * 100) / 100, suggestion };
  }

  // ═══════════════════════════════════════════════════
  // DRAG (screen coords converted to canvas coords via editor.scale)
  // ═══════════════════════════════════════════════════
  _onDrag(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { data } = box;
    let sx = e.clientX, sy = e.clientY;
    let ox = data.x,    oy = data.y;
    const s = this.editor?.scale ?? 1;

    const onMove = (ev) => {
      // Divide delta by scale: DOM positions are in canvas px, drag delta is in screen px
      data.x = ox + (ev.clientX - sx) / s;
      data.y = oy + (ev.clientY - sy) / s;
      box.el.style.left = `${data.x}px`;
      box.el.style.top  = `${data.y}px`;
      box.dirty = true; box.cache = null;
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
  // RESIZE SE / S / ROTATE
  // ═══════════════════════════════════════════════════
  _onResizeSE(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { data } = box;
    let sx = e.clientX, sw = data.w;
    const s = this.editor?.scale ?? 1;
    const onMove = (ev) => {
      data.w = Math.max(50, sw + (ev.clientX - sx) / s);
      box.el.style.width = `${data.w}px`;
      box.dirty = true; box.cache = null;
      this._schedulePreview();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  _onResizeS(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { data } = box;
    let sy = e.clientY, sh = data.h;
    const s = this.editor?.scale ?? 1;
    const onMove = (ev) => {
      data.h = Math.max(20, sh + (ev.clientY - sy) / s);
      box.el.style.minHeight = `${data.h}px`;
      box.dirty = true; box.cache = null;
      this._schedulePreview();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  _onRotate(e, id) {
    const box = this.boxes.get(id);
    if (!box) return;
    const { el, data } = box;
    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;

    const onMove = (ev) => {
      data.rotation = Math.round(Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI) + 90);
      el.style.transform = `rotate(${data.rotation}deg)`;
      box.dirty = true; box.cache = null;
      this._schedulePreview();
      const inp = document.getElementById('box-rotation');
      const val = document.getElementById('box-rotation-val');
      if (inp) inp.value = data.rotation;
      if (val) val.textContent = data.rotation;
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  // ── Helpers ──────────────────────────────────────────────
  _estH(data) {
    const cpp = Math.max(1, Math.floor(data.w / (data.fontSize * 0.58)));
    let tot = 0;
    for (const l of data.text.split('\n')) tot += Math.max(1, Math.ceil(l.length / cpp));
    return Math.max(data.fontSize * 1.5, tot * data.fontSize * 1.35 + 12);
  }
}

function _handle(cls, txt, handler) {
  const h = document.createElement('div');
  h.className = cls;
  if (txt) h.textContent = txt;
  h.addEventListener('mousedown', (e) => { e.stopPropagation(); handler(e); });
  return h;
}

function _isHandle(el) {
  return ['tb-resize-se','tb-resize-s','tb-rotate','tb-delete'].some(c => el.classList.contains(c));
}

function _rgba(hex, a) {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${a})`;
  return `rgba(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)},${a})`;
}
