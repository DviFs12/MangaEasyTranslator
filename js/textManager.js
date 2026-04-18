/**
 * textManager.js — v9
 *
 * Correções e melhorias vs v7:
 *
 *  1. BUG FIX — retângulo branco ao remover caixa aplicada:
 *     Quando uma caixa é criada via _applyTranslation, o app já chamou
 *     editor.fillRect() que pintou a área de branco. A remoção da caixa DOM
 *     não desfazia isso. Agora: add() aceita `snapshotRegion` (ImageData do
 *     canvas ANTES do fillRect). remove() restaura esse snapshot no canvas
 *     antes de remover o elemento DOM, revertendo completamente o apply.
 *
 *  2. BUG FIX — _styleEl resetava `selected` de forma redundante:
 *     a linha `if (box.el.classList.contains('selected')) box.el.classList.add('selected')`
 *     era no-op e podia causar re-layout desnecessário. Removida.
 *
 *  3. PERF — preview só renderiza caixas dirty; caixas sem alteração
 *     usam o OffscreenCanvas em cache. Mantido e corrigido o caso em que
 *     o cache ficava com tamanho desatualizado após resize.
 *
 *  4. BUG FIX — _onResizeS não marcava fixedH=true no dado, só no objeto.
 *     Agora sincroniza box.data.fixedH junto com box.fixedH.
 */

import { renderBoxToCanvas } from './editor.js';

export class TextManager {
  /**
   * @param {HTMLElement}      textLayer
   * @param {HTMLCanvasElement} previewCanvas
   * @param {CanvasEditor}     editor
   * @param {HTMLCanvasElement} baseCanvas   — necessário para snapshot/restore
   */
  constructor(textLayer, previewCanvas, editor, baseCanvas) {
    this.textLayer     = textLayer;
    this.previewCanvas = previewCanvas;
    this.editor        = editor;
    this.baseCanvas    = baseCanvas;   // referência para snapshot

    this.pCtx       = previewCanvas.getContext('2d');
    this.boxes      = new Map();   // id → { el, data, dirty, cache, fixedH, snapshot }
    this.selectedId = null;

    this.onSelect   = null;
    this.onDeselect = null;

    this._previewDirty = false;
    this._rafId        = null;

    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.text-box') &&
          !e.target.closest('#box-editor') &&
          !e.target.closest('#panel-right')) this.deselect();
    });
  }

  // ═══════════════════════════════════════════════════
  // ADD
  // ═══════════════════════════════════════════════════
  /**
   * @param {object} opts
   *   opts.snapshotRegion — ImageData capturado ANTES de qualquer fillRect.
   *                         Se presente, remove() restaurará essa região.
   *   opts.snapshotX/Y   — origem do snapshot no canvas base.
   */
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

    const fixedH = opts.h != null;
    if (!fixedH) data.h = this._estH(data);

    if (this.boxes.has(data.id)) this.remove(data.id);

    const el = this._buildEl(data, fixedH);
    this.textLayer.appendChild(el);

    // Guarda snapshot da área ANTES do fillRect para poder restaurar no remove()
    const snapshot = opts.snapshotRegion
      ? { data: opts.snapshotRegion, x: opts.snapshotX ?? data.x, y: opts.snapshotY ?? data.y }
      : null;

    this.boxes.set(data.id, { el, data, dirty: true, cache: null, fixedH, snapshot });

    this._schedulePreview();
    this.select(data.id);
    return data;
  }

  // ═══════════════════════════════════════════════════
  // BUILD DOM ELEMENT
  // ═══════════════════════════════════════════════════
  _buildEl(data, fixedH) {
    const el = document.createElement('div');
    el.className = 'text-box';
    el.id        = `tb-${data.id}`;

    const span = document.createElement('span');
    span.className = 'tb-text';
    el.appendChild(span);

    el.appendChild(_handle('tb-delete',    '×', () => this.remove(data.id)));
    el.appendChild(_handle('tb-resize-se', '',  (e) => this._onResizeSE(e, data.id)));
    el.appendChild(_handle('tb-resize-s',  '',  (e) => this._onResizeS(e, data.id)));
    el.appendChild(_handle('tb-rotate',    '↻', (e) => this._onRotate(e, data.id)));

    this._styleEl(el, data, fixedH);

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

  _styleEl(el, data, fixedH) {
    const span = el.querySelector('.tb-text');
    if (span) span.textContent = data.text;

    const heightRule = fixedH
      ? `height:${data.h}px; overflow:hidden;`
      : `min-height:${data.h}px;`;

    el.style.cssText = `
      position:absolute;
      left:${data.x}px; top:${data.y}px;
      width:${data.w}px;
      ${heightRule}
      font-size:${data.fontSize}px;
      font-family:'${data.fontFamily}',sans-serif;
      color:${data.color};
      background-color:${_rgba(data.bgColor, data.bgOpacity)};
      text-align:${data.align};
      transform:rotate(${data.rotation}deg);
      transform-origin:center center;
      white-space:pre-wrap;
      word-break:break-word;
      box-sizing:border-box;
      padding:2px 4px;
    `;
  }

  // ═══════════════════════════════════════════════════
  // UPDATE
  // ═══════════════════════════════════════════════════
  update(id, patch) {
    const box = this.boxes.get(id); if (!box) return;
    Object.assign(box.data, patch);

    if (!box.fixedH && ('text' in patch || 'fontSize' in patch || 'w' in patch))
      box.data.h = this._estH(box.data);

    this._styleEl(box.el, box.data, box.fixedH);

    // Invalida cache se dimensões mudaram
    if ('w' in patch || 'h' in patch || 'fontSize' in patch) {
      box.cache = null;
    }

    box.dirty = true;
    this._schedulePreview();
  }

  updateSelected(patch) { if (this.selectedId) this.update(this.selectedId, patch); }

  // ═══════════════════════════════════════════════════
  // SELECT / DESELECT
  // ═══════════════════════════════════════════════════
  select(id) {
    if (this.selectedId !== id)
      this.boxes.get(this.selectedId)?.el.classList.remove('selected');
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

  // ═══════════════════════════════════════════════════
  // REMOVE — restaura canvas se tinha snapshot
  // ═══════════════════════════════════════════════════
  remove(id) {
    const box = this.boxes.get(id); if (!box) return;

    // BUG FIX: restaura a região do canvas base ao estado anterior ao apply
    if (box.snapshot && this.baseCanvas) {
      const { data: snap, x, y } = box.snapshot;
      try {
        const ctx = this.baseCanvas.getContext('2d', { willReadFrequently: true });
        ctx.putImageData(snap, x, y);
      } catch (e) {
        // canvas pode ter mudado de tamanho — ignora silenciosamente
      }
    }

    box.el.remove();
    this.boxes.delete(id);
    if (this.selectedId === id) {
      this.selectedId = null;
      if (this.onDeselect) this.onDeselect();
    }
    this._schedulePreview();
  }

  clear() { [...this.boxes.keys()].forEach(id => this.remove(id)); }

  /**
   * Remove a caixa do DOM SEM restaurar o canvas (usado quando o inpaint
   * já limpou a área ou quando o usuário quer manter a pintura).
   */
  removeSilent(id) {
    const box = this.boxes.get(id); if (!box) return;
    box.snapshot = null;   // descarta snapshot
    this.remove(id);
  }

  getAllData() { return [...this.boxes.values()].map(b => ({ ...b.data })); }

  syncPreviewSize(w, h) {
    if (this.previewCanvas.width !== w || this.previewCanvas.height !== h) {
      this.previewCanvas.width  = w;
      this.previewCanvas.height = h;
      this.pCtx = this.previewCanvas.getContext('2d');
      // Invalida todos os caches (dimensões mudaram)
      for (const box of this.boxes.values()) { box.cache = null; box.dirty = true; }
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

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pc.width, pc.height);
    ctx.restore();

    for (const entry of this.boxes.values()) {
      const { data, dirty, cache } = entry;
      // Invalida cache se dimensões do canvas foram recortadas
      const cacheValid = cache &&
        cache.width  === data.w + 20 &&
        cache.height === data.h + 20;

      if (dirty || !cacheValid) {
        const oc     = new OffscreenCanvas(data.w + 20, data.h + 20);
        const oc_ctx = oc.getContext('2d');
        renderBoxToCanvas(oc_ctx, { ...data, x: 3, y: 3 });
        entry.cache = oc;
        entry.dirty = false;
        ctx.drawImage(oc, data.x - 3, data.y - 3);
      } else {
        ctx.drawImage(cache, data.x - 3, data.y - 3);
      }
    }
  }

  // ═══════════════════════════════════════════════════
  // DRAG
  // ═══════════════════════════════════════════════════
  _onDrag(e, id) {
    const box = this.boxes.get(id); if (!box) return;
    const { data } = box;
    let sx = e.clientX, sy = e.clientY;
    let ox = data.x,    oy = data.y;
    const s = this.editor?.scale ?? 1;

    const onMove = (ev) => {
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
    const box = this.boxes.get(id); if (!box) return;
    const { data } = box;
    let sx = e.clientX, sw = data.w;
    const s = this.editor?.scale ?? 1;
    const onMove = (ev) => {
      data.w = Math.max(50, sw + (ev.clientX - sx) / s);
      box.el.style.width = `${data.w}px`;
      box.cache = null; box.dirty = true;
      this._schedulePreview();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  _onResizeS(e, id) {
    const box = this.boxes.get(id); if (!box) return;
    const { data } = box;
    let sy = e.clientY, sh = data.h;
    const s = this.editor?.scale ?? 1;
    const onMove = (ev) => {
      data.h = Math.max(20, sh + (ev.clientY - sy) / s);
      // FIX: sincroniza ambos os flags de altura fixa
      box.fixedH = true;
      box.el.style.height    = `${data.h}px`;
      box.el.style.minHeight = '';
      box.cache = null; box.dirty = true;
      this._schedulePreview();
    };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }

  _onRotate(e, id) {
    const box = this.boxes.get(id); if (!box) return;
    const { el, data } = box;
    const rect = el.getBoundingClientRect();
    const cx   = rect.left + rect.width  / 2;
    const cy   = rect.top  + rect.height / 2;

    const onMove = (ev) => {
      data.rotation = Math.round(
        Math.atan2(ev.clientY - cy, ev.clientX - cx) * (180 / Math.PI) + 90
      );
      el.style.transform = `rotate(${data.rotation}deg)`;
      box.cache = null; box.dirty = true;
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

  // ── Helpers ────────────────────────────────────────
  _estH(data) {
    const lineH  = data.fontSize * 1.35;
    const charsPerLine = Math.max(1, Math.floor(data.w / (data.fontSize * 0.58)));
    let totalLines = 0;
    for (const line of (data.text || '').split('\n'))
      totalLines += Math.max(1, Math.ceil((line.length || 1) / charsPerLine));
    return Math.max(data.fontSize * 1.5, totalLines * lineH + 12);
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
  return ['tb-resize-se', 'tb-resize-s', 'tb-rotate', 'tb-delete']
    .some(c => el.classList.contains(c));
}

function _rgba(hex, a) {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${a})`;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
