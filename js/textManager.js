/**
 * textManager.js — Gerencia caixas de texto draggable/resizable sobre o canvas.
 */

export class TextManager {
  constructor(textLayer, canvasWrapper) {
    this.textLayer = textLayer;
    this.canvasWrapper = canvasWrapper;
    this.boxes = new Map(); // id → { el, data }
    this.selectedId = null;
    this.onSelect = null; // callback(id)

    // Clique fora deseleciona
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.text-overlay')) {
        this.deselect();
      }
    });
  }

  /**
   * Adiciona uma caixa de texto.
   * @param {object} opts
   */
  addBox({
    id,
    text,
    x = 50,
    y = 50,
    w = 120,
    fontSize = 18,
    fontFamily = 'Bangers',
    color = '#000000',
    bgColor = '#ffffff',
    bgOpacity = 0.85,
    align = 'center',
    scale = 1,
  }) {
    // Remove se já existe
    if (this.boxes.has(id)) this.removeBox(id);

    const el = document.createElement('div');
    el.className = 'text-overlay';
    el.id = `tbox-${id}`;

    el.style.left = `${x * scale}px`;
    el.style.top = `${y * scale}px`;
    el.style.width = `${w * scale}px`;
    el.style.fontSize = `${fontSize * scale}px`;
    el.style.fontFamily = `${fontFamily}, sans-serif`;
    el.style.color = color;
    el.style.backgroundColor = this._hexToRgba(bgColor, bgOpacity);
    el.style.textAlign = align;

    // Dataset para exportação
    el.dataset.text = text;
    el.dataset.fontSize = fontSize;
    el.dataset.fontFamily = fontFamily;
    el.dataset.color = color;
    el.dataset.bgColor = bgColor;
    el.dataset.bgOpacity = bgOpacity;
    el.dataset.align = align;

    el.innerText = text;

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'resize-handle';
    el.appendChild(resizeHandle);

    // Delete button
    const delBtn = document.createElement('div');
    delBtn.className = 'delete-btn';
    delBtn.innerText = '×';
    delBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.removeBox(id);
    });
    el.appendChild(delBtn);

    this._makeDraggable(el, id);
    this._makeResizable(el, resizeHandle, id);

    el.addEventListener('mousedown', (e) => {
      if (e.target === delBtn || e.target === resizeHandle) return;
      e.stopPropagation();
      this.select(id);
    });

    this.textLayer.appendChild(el);
    this.boxes.set(id, {
      el,
      data: { id, text, x, y, w, fontSize, fontFamily, color, bgColor, bgOpacity, align }
    });

    this.select(id);
    return el;
  }

  removeBox(id) {
    const box = this.boxes.get(id);
    if (!box) return;
    box.el.remove();
    this.boxes.delete(id);
    if (this.selectedId === id) this.selectedId = null;
  }

  select(id) {
    // Deseleciona anterior
    if (this.selectedId) {
      const prev = this.boxes.get(this.selectedId);
      if (prev) prev.el.classList.remove('selected');
    }
    this.selectedId = id;
    const box = this.boxes.get(id);
    if (box) {
      box.el.classList.add('selected');
      if (this.onSelect) this.onSelect(id, box.data);
    }
  }

  deselect() {
    if (this.selectedId) {
      const box = this.boxes.get(this.selectedId);
      if (box) box.el.classList.remove('selected');
    }
    this.selectedId = null;
  }

  updateSelected(opts) {
    if (!this.selectedId) return;
    const box = this.boxes.get(this.selectedId);
    if (!box) return;
    const { el, data } = box;
    const scale = this._getScale();

    if (opts.text !== undefined) {
      data.text = opts.text;
      el.dataset.text = opts.text;
      el.innerText = opts.text;
      // Re-add handles (innerText removes them)
      el.appendChild(el.querySelector('.resize-handle') || this._makeResizeHandle(el));
      el.appendChild(el.querySelector('.delete-btn') || this._makeDelBtn(el, this.selectedId));
    }
    if (opts.fontSize !== undefined) {
      data.fontSize = opts.fontSize;
      el.style.fontSize = `${opts.fontSize * scale}px`;
      el.dataset.fontSize = opts.fontSize;
    }
    if (opts.fontFamily !== undefined) {
      data.fontFamily = opts.fontFamily;
      el.style.fontFamily = `${opts.fontFamily}, sans-serif`;
      el.dataset.fontFamily = opts.fontFamily;
    }
    if (opts.color !== undefined) {
      data.color = opts.color;
      el.style.color = opts.color;
      el.dataset.color = opts.color;
    }
    if (opts.bgColor !== undefined || opts.bgOpacity !== undefined) {
      if (opts.bgColor !== undefined) data.bgColor = opts.bgColor;
      if (opts.bgOpacity !== undefined) data.bgOpacity = opts.bgOpacity;
      el.style.backgroundColor = this._hexToRgba(data.bgColor, data.bgOpacity);
      el.dataset.bgColor = data.bgColor;
      el.dataset.bgOpacity = data.bgOpacity;
    }
    if (opts.align !== undefined) {
      data.align = opts.align;
      el.style.textAlign = opts.align;
      el.dataset.align = opts.align;
    }
  }

  updateScale(scale) {
    for (const [, box] of this.boxes) {
      const { el, data } = box;
      el.style.left = `${data.x * scale}px`;
      el.style.top = `${data.y * scale}px`;
      el.style.width = `${data.w * scale}px`;
      el.style.fontSize = `${data.fontSize * scale}px`;
    }
  }

  clear() {
    for (const [id] of this.boxes) this.removeBox(id);
  }

  _getScale() {
    // Estima o scale a partir do tamanho visual vs original
    const canvas = this.canvasWrapper.querySelector('#base-canvas');
    if (!canvas) return 1;
    const rect = canvas.getBoundingClientRect();
    return rect.width / canvas.width;
  }

  _hexToRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${opacity})`;
  }

  _makeDraggable(el, id) {
    let startX, startY, startLeft, startTop;

    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - startX;
      const dy = clientY - startY;
      el.style.left = `${startLeft + dx}px`;
      el.style.top = `${startTop + dy}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);

      // Salvar posição real (sem scale)
      const scale = this._getScale();
      const box = this.boxes.get(id);
      if (box) {
        box.data.x = parseFloat(el.style.left) / scale;
        box.data.y = parseFloat(el.style.top) / scale;
      }
    };

    el.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('resize-handle') ||
          e.target.classList.contains('delete-btn')) return;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseFloat(el.style.left) || 0;
      startTop = parseFloat(el.style.top) || 0;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    el.addEventListener('touchstart', (e) => {
      if (e.target.classList.contains('resize-handle') ||
          e.target.classList.contains('delete-btn')) return;
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      startLeft = parseFloat(el.style.left) || 0;
      startTop = parseFloat(el.style.top) || 0;
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onUp);
    });
  }

  _makeResizable(el, handle, id) {
    let startX, startW;

    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const dx = clientX - startX;
      const newW = Math.max(60, startW + dx);
      el.style.width = `${newW}px`;
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      const scale = this._getScale();
      const box = this.boxes.get(id);
      if (box) box.data.w = parseFloat(el.style.width) / scale;
    };

    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startX = e.clientX;
      startW = parseFloat(el.style.width) || 100;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
}
