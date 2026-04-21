/**
 * renderer/text.js — MET10
 * Manages DOM text box overlays aligned with the canvas.
 * Handles resize/drag interactions and reports changes via callbacks.
 * No direct state mutations.
 */

import { fitTextInBox } from '../core/layout.js';

export class TextRenderer {
  /**
   * @param {HTMLElement} container  — element that wraps the canvases (same transform)
   * @param {HTMLCanvasElement} previewCanvas
   */
  constructor(container, previewCanvas) {
    this.container = container;
    this.previewCanvas = previewCanvas;
    this.pCtx = previewCanvas.getContext('2d');

    this._boxes = new Map(); // id → { el, data }
    this._selectedId = null;
    this._previewDirty = false;
    this._rafId = null;

    // Callbacks
    this.onSelect   = null; // (id) => void
    this.onDeselect = null; // () => void
    this.onChange   = null; // (id, patch) => void  — reports geometry changes

    document.addEventListener('mousedown', e => {
      if (!e.target.closest('.met-box') && !e.target.closest('#panel-box-editor')) {
        this.deselect();
      }
    });
  }

  // ── Add / Update / Remove ───────────────────────────────────────────────

  add(block) {
    if (this._boxes.has(block.id)) { this.update(block); return; }
    const el = this._makeElement(block);
    this.container.appendChild(el);
    this._boxes.set(block.id, { el, data: { ...block } });
    this._bindBox(el, block.id);
    this._styleBox(block.id);
    this._schedPreview();
  }

  update(block) {
    const entry = this._boxes.get(block.id);
    if (!entry) { this.add(block); return; }
    entry.data = { ...entry.data, ...block };
    this._styleBox(block.id);
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
    if (this._selectedId) {
      const prev = this._boxes.get(this._selectedId);
      if (prev) prev.el.classList.remove('selected');
    }
    this._selectedId = id;
    const entry = this._boxes.get(id);
    if (entry) { entry.el.classList.add('selected'); entry.el.scrollIntoView?.({ block: 'nearest' }); }
  }

  deselect() {
    if (!this._selectedId) return;
    const entry = this._boxes.get(this._selectedId);
    if (entry) entry.el.classList.remove('selected');
    this._selectedId = null;
    this.onDeselect?.();
  }

  // ── Preview render ──────────────────────────────────────────────────────

  _schedPreview() {
    if (this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._renderPreview();
    });
  }

  _renderPreview() {
    const pc = this.previewCanvas;
    const ctx = this.pCtx;
    ctx.clearRect(0, 0, pc.width, pc.height);
    for (const { data } of this._boxes.values()) {
      if (!data.visible || !data.translation) continue;
      this._renderBlockToCtx(ctx, data);
    }
  }

  renderToCanvas(targetCtx) {
    for (const { data } of this._boxes.values()) {
      if (!data.visible || !data.translation) continue;
      this._renderBlockToCtx(targetCtx, data);
    }
  }

  _renderBlockToCtx(ctx, block) {
    const { x, y, w, h, translation: text, fontSize, fontFamily = 'Bangers',
      color = '#000', bgColor = '#fff', bgOpacity = 0.9,
      align = 'center', rotation = 0 } = block;
    if (!text || !w || !h) return;

    const PAD = 6;
    const lhR = 1.25;
    const { lines, fontSize: fs } = _autoFontSize(text, w, h, fontFamily, fontSize, PAD, lhR);
    const lineH = fs * lhR;

    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    if (rotation) ctx.rotate(rotation * Math.PI / 180);
    ctx.translate(-w / 2, -h / 2);

    if (bgOpacity > 0) {
      ctx.globalAlpha = bgOpacity;
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    ctx.font = `${fs}px "${fontFamily}"`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    ctx.textAlign = align;
    const textX = align === 'center' ? w / 2 : align === 'right' ? w - PAD : PAD;
    const totalH = lines.length * lineH;
    const startY = Math.max(PAD, (h - totalH) / 2);
    lines.forEach((line, i) => ctx.fillText(line, textX, startY + i * lineH));
    ctx.restore();
  }

  // ── DOM element creation ────────────────────────────────────────────────

  _makeElement(block) {
    const el = document.createElement('div');
    el.className = 'met-box';
    el.dataset.id = block.id;
    el.innerHTML = `
      <div class="met-box-content"></div>
      <div class="met-box-handle met-box-handle-br" data-resize="br"></div>
      <div class="met-box-handle met-box-handle-r"  data-resize="r"></div>
      <div class="met-box-handle met-box-handle-b"  data-resize="b"></div>
    `;
    return el;
  }

  _styleBox(id) {
    const entry = this._boxes.get(id);
    if (!entry) return;
    const { el, data } = entry;
    const { x, y, w, h, translation, fontSize, fontFamily = 'Bangers',
      color = '#000', bgColor = '#fff', bgOpacity = 0.9,
      align = 'center', rotation = 0, visible } = data;

    el.style.cssText = `
      position: absolute;
      left: ${x}px; top: ${y}px;
      width: ${w}px; height: ${h}px;
      transform: rotate(${rotation}deg);
      transform-origin: center;
      display: ${visible ? 'block' : 'none'};
      box-sizing: border-box;
    `;

    // Render text content
    const content = el.querySelector('.met-box-content');
    if (content && translation) {
      const PAD = 6;
      const lhR = 1.25;
      const { lines, fontSize: fs } = _autoFontSize(translation, w, h, fontFamily, fontSize, PAD, lhR);
      const lineH = fs * lhR;
      const totalH = lines.length * lineH;

      content.style.cssText = `
        width: 100%; height: 100%;
        display: flex; align-items: center; justify-content: center;
        flex-direction: column;
        padding: ${PAD}px;
        box-sizing: border-box;
        overflow: hidden;
        background: ${_hexToRgba(bgColor, bgOpacity)};
        color: ${color};
        font-family: "${fontFamily}", sans-serif;
        font-size: ${fs}px;
        line-height: ${lhR};
        text-align: ${align};
        pointer-events: none;
        white-space: pre-wrap;
        word-break: break-word;
      `;
      content.textContent = translation;
    } else if (content) {
      content.style.cssText = `width:100%;height:100%;pointer-events:none;background:${_hexToRgba(bgColor, bgOpacity)};`;
      content.textContent = '';
    }
  }

  // ── Drag & Resize ───────────────────────────────────────────────────────

  _bindBox(el, id) {
    let dragState = null;

    el.addEventListener('mousedown', e => {
      if (e.target.dataset.resize) return; // handled by resize
      if (e.button !== 0) return;
      e.stopPropagation();
      this.select(id);
      this.onSelect?.(id);

      const entry = this._boxes.get(id);
      if (!entry) return;
      const { data } = entry;
      dragState = { startX: e.clientX, startY: e.clientY, ox: data.x, oy: data.y, mode: 'move' };

      const onMove = e2 => {
        if (!dragState) return;
        const dx = (e2.clientX - dragState.startX), dy = (e2.clientY - dragState.startY);
        const scale = _getScale(el);
        const newX = dragState.ox + dx / scale;
        const newY = dragState.oy + dy / scale;
        entry.data.x = newX; entry.data.y = newY;
        el.style.left = `${newX}px`; el.style.top = `${newY}px`;
      };
      const onUp = () => {
        if (dragState) {
          this.onChange?.(id, { x: entry.data.x, y: entry.data.y });
          dragState = null;
        }
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Resize handles
    el.querySelectorAll('[data-resize]').forEach(handle => {
      handle.addEventListener('mousedown', e => {
        e.stopPropagation(); e.preventDefault();
        const dir = handle.dataset.resize;
        const entry = this._boxes.get(id);
        if (!entry) return;
        const { data } = entry;
        const startX = e.clientX, startY = e.clientY;
        const ow = data.w, oh = data.h;

        const onMove = e2 => {
          const scale = _getScale(el);
          const dx = (e2.clientX - startX) / scale;
          const dy = (e2.clientY - startY) / scale;
          let nw = ow, nh = oh;
          if (dir.includes('r')) nw = Math.max(40, ow + dx);
          if (dir.includes('b')) nh = Math.max(20, oh + dy);
          entry.data.w = nw; entry.data.h = nh;
          el.style.width = `${nw}px`; el.style.height = `${nh}px`;
          this._styleBox(id);
        };
        const onUp = () => {
          this.onChange?.(id, { w: entry.data.w, h: entry.data.h });
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
      });
    });
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _autoFontSize(text, w, h, family, hintSize, pad, lhR) {
  const { fontSize, lines } = fitTextInBox(text, w, h, { fontFamily: family, padding: pad, lineHeightRatio: lhR, maxSize: hintSize || 72 });
  return { fontSize, lines };
}

function _hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function _getScale(el) {
  const world = el.closest('[style*="scale"]');
  if (!world) return 1;
  const m = world.style.transform.match(/scale\(([^)]+)\)/);
  return m ? parseFloat(m[1]) : 1;
}
