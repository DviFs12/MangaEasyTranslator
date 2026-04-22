/**
 * renderer/text.js — MET10
 *
 * BUGS CORRIGIDOS:
 *  - text-layer é dimensionado via setSize()
 *  - Drag usa getScale() callback corretamente
 *  - Deselect não dispara quando clica no box-editor
 *  - _applyStyle não usa cssText (evita sobrescrever tudo)
 *  - Preview canvas dimensionado corretamente
 */

import { fitTextInBox } from '../core/layout.js';

export class TextRenderer {
  /**
   * @param {HTMLElement}       layer         — #text-layer
   * @param {HTMLCanvasElement} previewCanvas
   * @param {() => number}      getScale      — retorna escala atual do renderer
   */
  constructor(layer, previewCanvas, getScale) {
    this.layer    = layer;
    this.preview  = previewCanvas;
    this.pCtx     = previewCanvas.getContext('2d');
    this.getScale = getScale ?? (() => 1);

    this._boxes      = new Map();  // id → { el, data }
    this._selectedId = null;
    this._rafId      = null;

    this.onSelect   = null;  // (id) => void
    this.onDeselect = null;  // () => void
    this.onChange   = null;  // (id, patch | null) => void

    document.addEventListener('mousedown', e => {
      if (
        !e.target.closest('.met-box') &&
        !e.target.closest('#box-editor')
      ) {
        this.deselect();
      }
    });
  }

  /** Chamar após loadImage para ajustar dimensões */
  setSize(w, h) {
    this.layer.style.width  = w + 'px';
    this.layer.style.height = h + 'px';
    this.preview.width  = w;
    this.preview.height = h;
    this._renderPreview();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────
  add(block) {
    if (this._boxes.has(block.id)) { this.update(block); return; }
    const el = this._createElement(block.id);
    this.layer.appendChild(el);
    this._boxes.set(block.id, { el, data: { ...block } });
    this._bindDrag(el, block.id);
    this._applyStyle(block.id);
    this._schedPreview();
  }

  update(block) {
    if (!this._boxes.has(block.id)) { this.add(block); return; }
    const entry = this._boxes.get(block.id);
    Object.assign(entry.data, block);
    this._applyStyle(block.id);
    this._schedPreview();
  }

  remove(id) {
    const entry = this._boxes.get(id);
    if (!entry) return;
    entry.el.remove();
    this._boxes.delete(id);
    if (this._selectedId === id) { this._selectedId = null; this.onDeselect?.(); }
    this._schedPreview();
  }

  clear() {
    for (const { el } of this._boxes.values()) el.remove();
    this._boxes.clear();
    this._selectedId = null;
    this._renderPreview();
  }

  select(id) {
    if (this._selectedId && this._selectedId !== id) {
      this._boxes.get(this._selectedId)?.el.classList.remove('selected');
    }
    this._selectedId = id;
    this._boxes.get(id)?.el.classList.add('selected');
  }

  deselect() {
    if (!this._selectedId) return;
    this._boxes.get(this._selectedId)?.el.classList.remove('selected');
    this._selectedId = null;
    this.onDeselect?.();
  }

  // ── Preview ───────────────────────────────────────────────────────────────
  _schedPreview() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._renderPreview();
    });
  }

  _renderPreview() {
    const ctx = this.pCtx;
    ctx.clearRect(0, 0, this.preview.width, this.preview.height);
    for (const { data } of this._boxes.values()) {
      if (data.visible !== false && data.translation) {
        this._renderToCtx(ctx, data);
      }
    }
  }

  /** Renderiza todas as caixas num contexto externo (export) */
  renderToCanvas(ctx) {
    for (const { data } of this._boxes.values()) {
      if (data.visible !== false && data.translation) {
        this._renderToCtx(ctx, data);
      }
    }
  }

  /** Renderiza uma caixa num contexto canvas */
  _renderToCtx(ctx, block) {
    const {
      x, y, w, h,
      translation: text,
      fontSize    = 18,
      fontFamily  = 'Bangers',
      color       = '#000000',
      bgColor     = '#ffffff',
      bgOpacity   = 0.9,
      align       = 'center',
      rotation    = 0,
    } = block;

    if (!text || w <= 0 || h <= 0) return;

    const PAD = 6, LH = 1.25;
    const { fontSize: fs, lines } = fitTextInBox(text, w, h, {
      fontFamily, padding: PAD, lineHeightRatio: LH, maxSize: fontSize,
    });
    const lineH = fs * LH;

    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    if (rotation) ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);

    if (bgOpacity > 0) {
      ctx.globalAlpha = bgOpacity;
      ctx.fillStyle   = bgColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    ctx.font         = `${fs}px "${fontFamily}"`;
    ctx.fillStyle    = color;
    ctx.textBaseline = 'top';
    ctx.textAlign    = align;
    const tx2    = align === 'center' ? w/2 : align === 'right' ? w-PAD : PAD;
    const totalH = lines.length * lineH;
    const sy     = Math.max(PAD, (h - totalH) / 2);
    lines.forEach((ln, i) => ctx.fillText(ln, tx2, sy + i * lineH));
    ctx.restore();
  }

  // ── DOM ───────────────────────────────────────────────────────────────────
  _createElement(id) {
    const el = document.createElement('div');
    el.className  = 'met-box';
    el.dataset.id = id;
    el.innerHTML  = `
      <div class="met-box-body"></div>
      <div class="met-box-handle h-br" data-dir="br"></div>
      <div class="met-box-handle h-r"  data-dir="r"></div>
      <div class="met-box-handle h-b"  data-dir="b"></div>
      <button class="met-box-del" title="Remover" type="button">✕</button>
    `;
    el.querySelector('.met-box-del').addEventListener('mousedown', e => {
      e.stopPropagation();
      e.preventDefault();
      this.onChange?.(id, null);
    });
    return el;
  }

  _applyStyle(id) {
    const entry = this._boxes.get(id);
    if (!entry) return;
    const { el, data } = entry;
    const {
      x, y, w, h,
      translation,
      fontSize   = 18,
      fontFamily = 'Bangers',
      color      = '#000000',
      bgColor    = '#ffffff',
      bgOpacity  = 0.9,
      align      = 'center',
      rotation   = 0,
      visible    = true,
    } = data;

    el.style.left      = `${x}px`;
    el.style.top       = `${y}px`;
    el.style.width     = `${w}px`;
    el.style.height    = `${h}px`;
    el.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    el.style.display   = visible ? '' : 'none';

    const body = el.querySelector('.met-box-body');
    if (!body) return;

    const bg = _rgba(bgColor, bgOpacity);

    if (translation) {
      const PAD = 6, LH = 1.25;
      const { fontSize: fs } = fitTextInBox(translation, w, h, {
        fontFamily, padding: PAD, lineHeightRatio: LH, maxSize: fontSize,
      });
      body.style.cssText = `
        width:100%;height:100%;box-sizing:border-box;
        padding:${PAD}px;overflow:hidden;
        background:${bg};
        color:${color};
        font-family:"${fontFamily}",sans-serif;
        font-size:${fs}px;line-height:${LH};
        text-align:${align};
        white-space:pre-wrap;word-break:break-word;
        display:flex;align-items:center;justify-content:center;
        pointer-events:none;user-select:none;
      `;
      body.textContent = translation;
    } else {
      body.style.cssText = `width:100%;height:100%;background:${bg};pointer-events:none;`;
      body.textContent   = '';
    }
  }

  // ── Drag & Resize ─────────────────────────────────────────────────────────
  _bindDrag(el, id) {
    // Drag (click no corpo da caixa)
    el.addEventListener('mousedown', e => {
      if (e.target.dataset.dir || e.target.classList.contains('met-box-del')) return;
      if (e.button !== 0) return;
      e.stopPropagation();

      this.select(id);
      this.onSelect?.(id);

      const entry = this._boxes.get(id);
      if (!entry) return;
      const { data } = entry;
      const ox = data.x, oy = data.y;
      const sx = e.clientX, sy = e.clientY;

      const onMove = ev => {
        const s  = this.getScale();
        data.x   = ox + (ev.clientX - sx) / s;
        data.y   = oy + (ev.clientY - sy) / s;
        el.style.left = `${data.x}px`;
        el.style.top  = `${data.y}px`;
      };
      const onUp = () => {
        this.onChange?.(id, { x: data.x, y: data.y });
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });

    // Resize handles
    el.querySelectorAll('[data-dir]').forEach(handle => {
      handle.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        const dir   = handle.dataset.dir;
        const entry = this._boxes.get(id);
        if (!entry) return;
        const { data } = entry;
        const ow = data.w, oh = data.h;
        const sx = e.clientX,  sy = e.clientY;

        const onMove = ev => {
          const s = this.getScale();
          const dx = (ev.clientX - sx) / s;
          const dy = (ev.clientY - sy) / s;
          if (dir.includes('r')) { data.w = Math.max(40, ow + dx); el.style.width  = `${data.w}px`; }
          if (dir.includes('b')) { data.h = Math.max(20, oh + dy); el.style.height = `${data.h}px`; }
          this._applyStyle(id);
        };
        const onUp = () => {
          this.onChange?.(id, { w: data.w, h: data.h });
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });
  }
}

function _rgba(hex, a) {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${a})`;
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}
