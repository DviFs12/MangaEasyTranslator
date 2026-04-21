/**
 * renderer/text.js — MET10 (reescrito)
 *
 * CORREÇÕES:
 *  - text-layer agora é posicionado absolutamente sobre o canvas e tem as
 *    mesmas dimensões do canvas base (atualizado em setSize).
 *  - Drag/resize usa a escala do canvas-world via renderer.scale (passado
 *    como getter) em vez de tentar inferir pelo DOM.
 *  - _styleBox corrigida para usar apenas position:absolute (sem cssText
 *    que sobrescrevia tudo).
 *  - Adicionado top-resize handle e botão flutuante de delete.
 */

import { fitTextInBox } from '../core/layout.js';

export class TextRenderer {
  /**
   * @param {HTMLElement}       container     — #text-layer (dentro de #canvas-world)
   * @param {HTMLCanvasElement} previewCanvas — canvas de preview (mesmas dims do base)
   * @param {() => number}      getScale      — retorna a escala atual do renderer
   */
  constructor(container, previewCanvas, getScale) {
    this.container     = container;
    this.previewCanvas = previewCanvas;
    this.getScale      = getScale ?? (() => 1);
    this.pCtx          = previewCanvas.getContext('2d');

    this._boxes      = new Map();   // id → { el, data }
    this._selectedId = null;
    this._rafId      = null;

    this.onSelect   = null;
    this.onDeselect = null;
    this.onChange   = null;

    // Deselect on outside click
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('.met-box') &&
          !e.target.closest('#box-editor') &&
          !e.target.closest('#panel-right')) {
        this.deselect();
      }
    });
  }

  /** Deve ser chamado sempre que o canvas base muda de tamanho */
  setSize(w, h) {
    this.container.style.width  = w + 'px';
    this.container.style.height = h + 'px';
    this.previewCanvas.width  = w;
    this.previewCanvas.height = h;
    this._schedPreview();
  }

  // ── Add / Update / Remove ─────────────────────────────────────────────

  add(block) {
    if (this._boxes.has(block.id)) { this.update(block); return; }
    const el = this._createElement(block);
    this.container.appendChild(el);
    this._boxes.set(block.id, { el, data: { ...block } });
    this._bindDrag(el, block.id);
    this._applyStyle(block.id);
    this._schedPreview();
  }

  update(block) {
    const entry = this._boxes.get(block.id);
    if (!entry) { this.add(block); return; }
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
    this._schedPreview();
  }

  select(id) {
    if (this._selectedId && this._selectedId !== id) {
      const prev = this._boxes.get(this._selectedId);
      prev?.el.classList.remove('selected');
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

  // ── Preview canvas ────────────────────────────────────────────────────

  _schedPreview() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._renderPreview();
    });
  }

  _renderPreview() {
    const ctx = this.pCtx;
    ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    for (const { data } of this._boxes.values()) {
      if (data.visible && data.translation) this._renderToCtx(ctx, data);
    }
  }

  /** Renderiza todas as caixas num ctx externo (para export) */
  renderToCanvas(ctx) {
    for (const { data } of this._boxes.values()) {
      if (data.visible && data.translation) this._renderToCtx(ctx, data);
    }
  }

  /** Renderiza uma única caixa num ctx externo */
  _renderToCtx(ctx, block) {
    const {
      x, y, w, h, translation: text,
      fontSize = 18, fontFamily = 'Bangers',
      color = '#000000', bgColor = '#ffffff', bgOpacity = 0.9,
      align = 'center', rotation = 0,
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
    const tx2    = align === 'center' ? w / 2 : align === 'right' ? w - PAD : PAD;
    const totalH = lines.length * lineH;
    const sy     = Math.max(PAD, (h - totalH) / 2);
    lines.forEach((ln, i) => ctx.fillText(ln, tx2, sy + i * lineH));
    ctx.restore();
  }

  // ── DOM element ───────────────────────────────────────────────────────

  _createElement(block) {
    const el = document.createElement('div');
    el.className  = 'met-box';
    el.dataset.id = block.id;
    el.innerHTML  = `
      <div class="met-box-body"></div>
      <div class="met-box-handle h-br" data-dir="br"></div>
      <div class="met-box-handle h-r"  data-dir="r"></div>
      <div class="met-box-handle h-b"  data-dir="b"></div>
      <button class="met-box-del" title="Remover">✕</button>
    `;
    el.querySelector('.met-box-del').addEventListener('mousedown', e => {
      e.stopPropagation();
      this.onChange?.(block.id, null);  // null = sinal de remoção
    });
    return el;
  }

  _applyStyle(id) {
    const entry = this._boxes.get(id);
    if (!entry) return;
    const { el, data } = entry;
    const {
      x, y, w, h, translation,
      fontSize = 18, fontFamily = 'Bangers',
      color = '#000000', bgColor = '#ffffff', bgOpacity = 0.9,
      align = 'center', rotation = 0, visible = true,
    } = data;

    // Posição e dimensões
    el.style.left      = `${x}px`;
    el.style.top       = `${y}px`;
    el.style.width     = `${w}px`;
    el.style.height    = `${h}px`;
    el.style.transform = rotation ? `rotate(${rotation}deg)` : '';
    el.style.display   = visible ? '' : 'none';

    // Conteúdo do corpo
    const body = el.querySelector('.met-box-body');
    if (!body) return;

    const bgCSS = _rgba(bgColor, bgOpacity);

    if (translation) {
      const PAD = 6, LH = 1.25;
      const { fontSize: fs } = fitTextInBox(translation, w, h, {
        fontFamily, padding: PAD, lineHeightRatio: LH, maxSize: fontSize,
      });
      body.style.cssText = [
        'width:100%', 'height:100%', 'box-sizing:border-box',
        `padding:${PAD}px`, `background:${bgCSS}`,
        `color:${color}`, `font-family:"${fontFamily}",sans-serif`,
        `font-size:${fs}px`, `line-height:${LH}`,
        `text-align:${align}`, 'overflow:hidden',
        'white-space:pre-wrap', 'word-break:break-word',
        'display:flex', 'align-items:center', 'justify-content:center',
        'pointer-events:none',
      ].join(';');
      body.textContent = translation;
    } else {
      body.style.cssText = `width:100%;height:100%;background:${bgCSS};pointer-events:none;`;
      body.textContent   = '';
    }
  }

  // ── Drag & Resize ────────────────────────────────────────────────────

  _bindDrag(el, id) {
    // Drag (body area)
    el.addEventListener('mousedown', e => {
      if (e.target.dataset.dir || e.target.classList.contains('met-box-del')) return;
      if (e.button !== 0) return;
      e.stopPropagation();

      this.select(id);
      this.onSelect?.(id);

      const entry = this._boxes.get(id);
      if (!entry) return;

      const ox = entry.data.x, oy = entry.data.y;
      const sx = e.clientX,    sy = e.clientY;

      const onMove = ev => {
        const s  = this.getScale();
        const nx = ox + (ev.clientX - sx) / s;
        const ny = oy + (ev.clientY - sy) / s;
        entry.data.x   = nx;
        entry.data.y   = ny;
        el.style.left  = `${nx}px`;
        el.style.top   = `${ny}px`;
      };
      const onUp = () => {
        this.onChange?.(id, { x: entry.data.x, y: entry.data.y });
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup',   onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup',   onUp);
    });

    // Resize handles
    el.querySelectorAll('.met-box-handle').forEach(h => {
      h.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        const dir   = h.dataset.dir;
        const entry = this._boxes.get(id);
        if (!entry) return;

        const ow = entry.data.w, oh = entry.data.h;
        const sx = e.clientX,    sy = e.clientY;

        const onMove = ev => {
          const s  = this.getScale();
          const dx = (ev.clientX - sx) / s;
          const dy = (ev.clientY - sy) / s;
          if (dir.includes('r')) { entry.data.w = Math.max(40, ow + dx); el.style.width  = `${entry.data.w}px`; }
          if (dir.includes('b')) { entry.data.h = Math.max(20, oh + dy); el.style.height = `${entry.data.h}px`; }
          this._applyStyle(id);
        };
        const onUp = () => {
          this.onChange?.(id, { w: entry.data.w, h: entry.data.h });
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _rgba(hex, a) {
  if (!hex || hex.length < 7) return `rgba(255,255,255,${a})`;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${a})`;
}
