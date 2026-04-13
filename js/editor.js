/**
 * editor.js — Editor de canvas: pincel de apagar, zoom, undo.
 */

export class CanvasEditor {
  constructor(baseCanvas, overlayCanvas) {
    this.baseCanvas = baseCanvas;
    this.overlayCanvas = overlayCanvas;
    this.ctx = baseCanvas.getContext('2d');
    this.overlayCtx = overlayCanvas.getContext('2d');

    this.brushActive = false;
    this.brushMode = 'white'; // 'white' | 'blur' | 'clone'
    this.brushSize = 20;
    this.brushColor = '#ffffff';

    this.isDrawing = false;
    this.lastX = 0;
    this.lastY = 0;

    // Undo stack
    this.undoStack = [];
    this.MAX_UNDO = 20;

    // Zoom & pan
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;

    // Source image
    this.sourceImage = null;

    this._bindEvents();
  }

  loadImage(img) {
    this.sourceImage = img;
    this.baseCanvas.width = img.naturalWidth;
    this.baseCanvas.height = img.naturalHeight;
    this.overlayCanvas.width = img.naturalWidth;
    this.overlayCanvas.height = img.naturalHeight;
    this.ctx.drawImage(img, 0, 0);
    this.saveUndo();
  }

  // ---- UNDO ----
  saveUndo() {
    const imageData = this.ctx.getImageData(0, 0, this.baseCanvas.width, this.baseCanvas.height);
    this.undoStack.push(imageData);
    if (this.undoStack.length > this.MAX_UNDO) this.undoStack.shift();
  }

  undo() {
    if (this.undoStack.length < 2) return false;
    this.undoStack.pop(); // remove estado atual
    const prev = this.undoStack[this.undoStack.length - 1];
    this.ctx.putImageData(prev, 0, 0);
    return true;
  }

  // ---- BRUSH ----
  activateBrush(active) {
    this.brushActive = active;
    this.baseCanvas.style.pointerEvents = active ? 'all' : 'none';
  }

  setMode(mode) { this.brushMode = mode; }
  setSize(size) { this.brushSize = size; }
  setColor(color) { this.brushColor = color; }

  _getCanvasPos(e) {
    const rect = this.baseCanvas.getBoundingClientRect();
    const scaleX = this.baseCanvas.width / rect.width;
    const scaleY = this.baseCanvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY,
    };
  }

  _bindEvents() {
    const start = (e) => {
      if (!this.brushActive) return;
      e.preventDefault();
      this.isDrawing = true;
      const pos = this._getCanvasPos(e);
      this.lastX = pos.x;
      this.lastY = pos.y;
      this.saveUndo();
      this._draw(pos.x, pos.y, pos.x, pos.y);
    };

    const move = (e) => {
      if (!this.brushActive || !this.isDrawing) return;
      e.preventDefault();
      const pos = this._getCanvasPos(e);
      this._draw(this.lastX, this.lastY, pos.x, pos.y);
      this.lastX = pos.x;
      this.lastY = pos.y;
    };

    const end = () => { this.isDrawing = false; };

    this.baseCanvas.addEventListener('mousedown', start);
    this.baseCanvas.addEventListener('mousemove', move);
    this.baseCanvas.addEventListener('mouseup', end);
    this.baseCanvas.addEventListener('mouseleave', end);
    this.baseCanvas.addEventListener('touchstart', start, { passive: false });
    this.baseCanvas.addEventListener('touchmove', move, { passive: false });
    this.baseCanvas.addEventListener('touchend', end);
  }

  _draw(x1, y1, x2, y2) {
    const ctx = this.ctx;
    const r = this.brushSize / 2;

    if (this.brushMode === 'white') {
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = this.brushColor;
      ctx.fillStyle = this.brushColor;
      ctx.lineWidth = this.brushSize;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.restore();
    } else if (this.brushMode === 'blur') {
      // Blur por sampling de pixels vizinhos
      const blurRadius = Math.floor(r);
      const srcData = ctx.getImageData(
        Math.max(0, x2 - blurRadius * 2),
        Math.max(0, y2 - blurRadius * 2),
        blurRadius * 4, blurRadius * 4
      );
      ctx.save();
      ctx.filter = `blur(${Math.floor(r * 0.6)}px)`;
      ctx.globalCompositeOperation = 'source-over';
      // Desenha a região de volta com blur
      const tmp = document.createElement('canvas');
      tmp.width = blurRadius * 4;
      tmp.height = blurRadius * 4;
      tmp.getContext('2d').putImageData(srcData, 0, 0);
      ctx.drawImage(
        tmp,
        Math.max(0, x2 - blurRadius * 2),
        Math.max(0, y2 - blurRadius * 2)
      );
      ctx.restore();
      // Máscara circular
      ctx.save();
      ctx.globalCompositeOperation = 'destination-in';
      ctx.restore();
    } else if (this.brushMode === 'clone') {
      // Clone stamp: copia pixels de uma região vizinha
      ctx.save();
      const offset = this.brushSize * 2;
      ctx.drawImage(
        this.baseCanvas,
        Math.max(0, x2 - r + offset),
        Math.max(0, y2 - r),
        this.brushSize, this.brushSize,
        x2 - r, y2 - r,
        this.brushSize, this.brushSize
      );
      ctx.restore();
    }
  }

  // ---- FILL BBOX (para apagar texto OCR) ----
  fillRect(x, y, w, h, color = '#ffffff') {
    this.saveUndo();
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  // ---- OVERLAY (bounding boxes OCR) ----
  drawOverlay(blocks, selectedId = null) {
    const ctx = this.overlayCtx;
    ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);

    for (const block of blocks) {
      if (!block.visible) continue;
      const { x, y, w, h } = block.bbox;
      const isSelected = block.id === selectedId;

      ctx.save();
      ctx.strokeStyle = isSelected ? '#e63946' : '#457b9d';
      ctx.lineWidth = isSelected ? 2.5 : 1.5;
      ctx.setLineDash(isSelected ? [] : [4, 3]);
      ctx.strokeRect(x + 0.5, y + 0.5, w, h);

      // Label
      ctx.fillStyle = isSelected ? '#e63946' : '#457b9d';
      ctx.fillRect(x, y - 16, 22, 16);
      ctx.fillStyle = 'white';
      ctx.font = 'bold 10px Nunito, sans-serif';
      ctx.fillText(block.id.split('-')[1] || '?', x + 3, y - 4);

      ctx.restore();
    }
  }

  clearOverlay() {
    this.overlayCtx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  // ---- EXPORT ----
  /**
   * Retorna um dataURL da imagem final com os textos renderizados.
   * @param {HTMLElement} textLayer - div com .text-overlay elements
   * @param {number} scale - escala atual do canvas (zoom)
   */
  async exportImage(textLayer, scale = 1) {
    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = this.baseCanvas.width;
    exportCanvas.height = this.baseCanvas.height;
    const ectx = exportCanvas.getContext('2d');

    // 1. Base canvas (imagem + pinceladas)
    ectx.drawImage(this.baseCanvas, 0, 0);

    // 2. Renderizar textos overlay no canvas de exportação
    const textEls = textLayer.querySelectorAll('.text-overlay');
    for (const el of textEls) {
      const left = parseFloat(el.style.left) / scale;
      const top = parseFloat(el.style.top) / scale;
      const width = parseFloat(el.style.width) / scale;
      const fontSize = parseFloat(el.dataset.fontSize || 18) / scale;
      const fontFamily = el.dataset.fontFamily || 'Nunito';
      const color = el.dataset.color || '#000000';
      const bgColor = el.dataset.bgColor || '#ffffff';
      const bgOpacity = parseFloat(el.dataset.bgOpacity || 0.85);
      const align = el.dataset.align || 'center';
      const text = el.dataset.text || el.innerText;

      // Medir altura real
      ectx.font = `bold ${fontSize}px ${fontFamily}, sans-serif`;
      const lines = wrapText(ectx, text, width - 12);
      const lineH = fontSize * 1.35;
      const totalH = lines.length * lineH + 10;

      // Fundo
      ectx.save();
      ectx.globalAlpha = bgOpacity;
      ectx.fillStyle = bgColor;
      const pad = 5;
      ectx.fillRect(left - pad, top - pad, width + pad * 2, totalH + pad);
      ectx.restore();

      // Texto
      ectx.save();
      ectx.font = `bold ${fontSize}px ${fontFamily}, sans-serif`;
      ectx.fillStyle = color;
      ectx.textAlign = align;
      ectx.textBaseline = 'top';

      const textX = align === 'center' ? left + width / 2 :
                    align === 'right' ? left + width - 4 : left + 4;

      for (let i = 0; i < lines.length; i++) {
        ectx.fillText(lines[i], textX, top + i * lineH + 2);
      }
      ectx.restore();
    }

    return exportCanvas.toDataURL('image/png');
  }
}

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}
