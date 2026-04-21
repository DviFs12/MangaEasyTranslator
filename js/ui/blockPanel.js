/**
 * ui/blockPanel.js — MET10
 * Lista de blocos OCR/texto com botão de tradução individual.
 */

import { t } from '../state/i18n.js';

export class BlockPanel {
  constructor(container, callbacks) {
    this.container = container;
    this.cb        = callbacks;
    this._lang     = 'pt';
  }

  setLang(lang) { this._lang = lang; }

  render(blocks, activeId) {
    if (!blocks.length) {
      this.container.innerHTML = `<p class="no-blocks">${t(this._lang,'statusNoBlocks')}</p>`;
      return;
    }
    const frag = document.createDocumentFragment();
    blocks.forEach(b => frag.appendChild(this._card(b, b.id === activeId)));
    this.container.innerHTML = '';
    this.container.appendChild(frag);
  }

  _card(block, isActive) {
    const card = document.createElement('div');
    card.className = `block-card${isActive?' active':''}${block.applied?' applied':''}`;
    card.dataset.blockId = block.id;

    const conf = block.confidence
      ? `<span class="block-conf">${block.confidence}%</span>` : '';

    card.innerHTML = `
      <div class="block-card-header">
        <span class="block-num">${_shortId(block.id)}</span>
        ${conf}
        ${block.applied ? `<span class="badge-applied">✓</span>` : ''}
        <button class="bc-btn bc-del" data-action="remove" title="Remover">✕</button>
      </div>
      <div class="block-ocr">${_esc(block.text) || '<em style="color:var(--c-muted)">sem texto</em>'}</div>
      ${block.translation
        ? `<div class="block-trans">${_esc(block.translation)}</div>`
        : `<div class="block-trans empty">—</div>`}
      <div class="block-actions">
        <button class="bc-btn" data-action="ocr"      title="Re-executar OCR">OCR</button>
        <button class="bc-btn" data-action="translate" title="Traduzir este bloco">🌐</button>
        <button class="bc-btn" data-action="clean"    title="Limpar texto (inpaint suave)">🧹</button>
        <button class="bc-btn" data-action="inpaint"  title="Inpaint da região">🎨</button>
        <button class="bc-btn bc-apply${block.applied?' is-applied':''}" data-action="apply">
          ${block.applied ? '✓ Aplicado' : 'Aplicar'}
        </button>
      </div>
    `;

    card.addEventListener('click', e => {
      const btn    = e.target.closest('[data-action]');
      const action = btn?.dataset.action;
      if (action) {
        e.stopPropagation();
        const handler = this.cb[`on${action.charAt(0).toUpperCase()+action.slice(1)}`];
        handler?.(block.id);
      } else {
        this.cb.onSelect?.(block.id);
      }
    });

    return card;
  }
}

function _shortId(id) {
  const n = id.match(/(\d+)/g);
  return '#' + (n ? String(parseInt(n[n.length-1]) % 10000).padStart(4,'0') : id.slice(-4));
}
function _esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
