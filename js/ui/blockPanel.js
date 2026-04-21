/**
 * ui/blockPanel.js — MET10
 * Renders the list of OCR/text blocks in the right panel.
 * Emits action requests via callbacks — no direct state mutations.
 */

import { t } from '../state/i18n.js';

export class BlockPanel {
  /**
   * @param {HTMLElement} container
   * @param {{ onSelect, onRemove, onOcr, onInpaint, onClean, onApply }} callbacks
   */
  constructor(container, callbacks) {
    this.container = container;
    this.cb = callbacks;
    this._lang = 'pt';
  }

  setLang(lang) { this._lang = lang; }

  render(blocks, activeBlockId) {
    if (!blocks.length) {
      this.container.innerHTML = `<p class="no-blocks">${t(this._lang, 'statusNoBlocks')}</p>`;
      return;
    }

    const frag = document.createDocumentFragment();
    for (const block of blocks) {
      const card = this._makeCard(block, block.id === activeBlockId);
      frag.appendChild(card);
    }
    this.container.innerHTML = '';
    this.container.appendChild(frag);
  }

  updateCard(block) {
    const existing = this.container.querySelector(`[data-block-id="${block.id}"]`);
    if (!existing) return;
    const newCard = this._makeCard(block, existing.classList.contains('active'));
    existing.replaceWith(newCard);
  }

  _makeCard(block, isActive) {
    const card = document.createElement('div');
    card.className = `block-card${isActive ? ' active' : ''}${block.applied ? ' applied' : ''}`;
    card.dataset.blockId = block.id;

    const conf = block.confidence ? `<span class="block-conf">${block.confidence}%</span>` : '';
    const applied = block.applied
      ? `<span class="block-applied-badge">${t(this._lang, 'blockApplied')}</span>`
      : '';

    card.innerHTML = `
      <div class="block-card-header">
        <span class="block-id">${_shortId(block.id)}</span>
        ${conf}${applied}
        <button class="block-btn block-btn-remove" title="${t(this._lang, 'blockDelete')}" data-action="remove">✕</button>
      </div>
      <div class="block-ocr-text">${_esc(block.text) || '<em>—</em>'}</div>
      ${block.translation ? `<div class="block-trans-text">${_esc(block.translation)}</div>` : ''}
      <div class="block-card-actions">
        <button class="block-btn" data-action="ocr" title="${t(this._lang, 'blockOcr')}">OCR</button>
        <button class="block-btn" data-action="clean" title="${t(this._lang, 'blockClean')}">🧹</button>
        <button class="block-btn" data-action="inpaint" title="${t(this._lang, 'blockInpaint')}">🎨</button>
        <button class="block-btn block-btn-apply${block.applied ? ' applied' : ''}" data-action="apply">
          ${block.applied ? t(this._lang, 'blockApplied') : t(this._lang, 'blockApply')}
        </button>
      </div>
    `;

    // Events
    card.addEventListener('click', e => {
      const action = e.target.dataset.action;
      if (action) {
        e.stopPropagation();
        this.cb[`on${_capitalize(action)}`]?.(block.id);
      } else {
        this.cb.onSelect?.(block.id);
      }
    });

    return card;
  }
}

function _shortId(id) {
  const parts = id.split('-');
  return '#' + (parts[1] ?? parts[0]).slice(-4);
}

function _esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function _capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
