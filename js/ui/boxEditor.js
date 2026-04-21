/**
 * ui/boxEditor.js — MET10
 * The right-panel editor for a selected text block.
 * Emits change events via onChange callback.
 * No direct state mutations.
 */

import { t } from '../state/i18n.js';

export const FONTS = [
  { name: 'Bangers',        label: 'Bangers' },
  { name: 'Anton',          label: 'Anton' },
  { name: 'Bebas Neue',     label: 'Bebas Neue' },
  { name: 'Oswald',         label: 'Oswald' },
  { name: 'Nunito',         label: 'Nunito' },
  { name: 'Permanent Marker', label: 'Permanent Marker' },
  { name: 'Comic Neue',     label: 'Comic Neue' },
  { name: 'Luckiest Guy',   label: 'Luckiest Guy' },
  { name: 'Fredoka One',    label: 'Fredoka One' },
  { name: 'Lilita One',     label: 'Lilita One' },
  { name: 'Righteous',      label: 'Righteous' },
  { name: 'Special Elite',  label: 'Special Elite' },
  { name: 'Press Start 2P', label: 'Press Start 2P' },
  { name: 'Shadows Into Light', label: 'Shadows Into Light' },
  { name: 'Noto Sans JP',   label: 'Noto Sans JP' },
];

export class BoxEditor {
  /**
   * @param {HTMLElement} panel
   * @param {(id: string, patch: object) => void} onChange
   */
  constructor(panel, onChange) {
    this.panel = panel;
    this.onChange = onChange;
    this._currentId = null;
    this._lang = 'pt';

    this._buildUI();
    this._bindEvents();
  }

  setLang(lang) {
    this._lang = lang;
    this._updateLabels();
  }

  show(block) {
    this._currentId = block.id;
    this._populate(block);
    this.panel.classList.remove('hidden');
  }

  hide() {
    this._currentId = null;
    this.panel.classList.add('hidden');
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  _buildUI() {
    this.panel.innerHTML = `
      <div class="box-editor-header">
        <span class="box-editor-title" id="be-id-label">—</span>
        <button id="be-close" class="btn-icon" title="Close">✕</button>
      </div>

      <div class="be-group">
        <label class="be-label" id="be-lbl-ocr">OCR</label>
        <textarea id="be-ocr" rows="3" class="be-textarea" placeholder="—"></textarea>
      </div>

      <div class="be-group">
        <label class="be-label" id="be-lbl-trans">Translation</label>
        <textarea id="be-trans" rows="3" class="be-textarea"></textarea>
      </div>

      <div class="be-row">
        <div class="be-group be-group-sm">
          <label class="be-label" id="be-lbl-font">Font</label>
          <select id="be-font" class="be-select">
            ${FONTS.map(f => `<option value="${f.name}">${f.label}</option>`).join('')}
          </select>
        </div>
        <div class="be-group be-group-sm">
          <label class="be-label" id="be-lbl-size">Size</label>
          <div class="be-row-inner">
            <input id="be-size" type="number" min="6" max="120" class="be-input-sm" />
            <label class="be-check-label"><input id="be-auto" type="checkbox" /> <span id="be-lbl-auto">Auto</span></label>
          </div>
        </div>
      </div>

      <div class="be-row">
        <div class="be-group be-group-sm">
          <label class="be-label" id="be-lbl-color">Color</label>
          <input id="be-color" type="color" class="be-color" />
        </div>
        <div class="be-group be-group-sm">
          <label class="be-label" id="be-lbl-bg">Background</label>
          <input id="be-bg" type="color" class="be-color" />
        </div>
      </div>

      <div class="be-group">
        <label class="be-label" id="be-lbl-opacity">Opacity <span id="be-opacity-val">0.9</span></label>
        <input id="be-opacity" type="range" min="0" max="1" step="0.05" class="be-range" />
      </div>

      <div class="be-group">
        <label class="be-label" id="be-lbl-rotation">Rotation <span id="be-rotation-val">0°</span></label>
        <input id="be-rotation" type="range" min="-180" max="180" step="1" class="be-range" />
      </div>

      <div class="be-group">
        <label class="be-label" id="be-lbl-align">Align</label>
        <div class="be-align-btns">
          <button class="be-align-btn" data-align="left">⬅</button>
          <button class="be-align-btn" data-align="center">☰</button>
          <button class="be-align-btn" data-align="right">➡</button>
        </div>
      </div>
    `;
  }

  _bindEvents() {
    const el = this.panel;
    const emit = (patch) => { if (this._currentId) this.onChange(this._currentId, patch); };

    el.querySelector('#be-close')?.addEventListener('click', () => this.hide());

    el.querySelector('#be-ocr')?.addEventListener('input', e => emit({ text: e.target.value }));
    el.querySelector('#be-trans')?.addEventListener('input', e => emit({ translation: e.target.value }));
    el.querySelector('#be-font')?.addEventListener('change', e => emit({ fontFamily: e.target.value }));
    el.querySelector('#be-size')?.addEventListener('change', e => emit({ fontSize: parseInt(e.target.value) }));
    el.querySelector('#be-auto')?.addEventListener('change', e => emit({ autoFontSize: e.target.checked }));
    el.querySelector('#be-color')?.addEventListener('input', e => emit({ color: e.target.value }));
    el.querySelector('#be-bg')?.addEventListener('input', e => emit({ bgColor: e.target.value }));

    el.querySelector('#be-opacity')?.addEventListener('input', e => {
      const v = parseFloat(e.target.value);
      el.querySelector('#be-opacity-val').textContent = v.toFixed(2);
      emit({ bgOpacity: v });
    });

    el.querySelector('#be-rotation')?.addEventListener('input', e => {
      const v = parseInt(e.target.value);
      el.querySelector('#be-rotation-val').textContent = v + '°';
      emit({ rotation: v });
    });

    el.querySelectorAll('.be-align-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        el.querySelectorAll('.be-align-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        emit({ align: btn.dataset.align });
      });
    });
  }

  _populate(block) {
    const el = this.panel;
    const get = id => el.querySelector(`#${id}`);

    get('be-id-label').textContent = `#${block.id.slice(-6)}`;
    get('be-ocr').value = block.text || '';
    get('be-trans').value = block.translation || '';
    get('be-font').value = block.fontFamily || 'Bangers';
    get('be-size').value = block.fontSize || 18;
    get('be-auto').checked = block.autoFontSize || false;
    get('be-color').value = block.color || '#000000';
    get('be-bg').value = block.bgColor || '#ffffff';

    const op = block.bgOpacity ?? 0.9;
    get('be-opacity').value = op;
    get('be-opacity-val').textContent = op.toFixed(2);

    const rot = block.rotation || 0;
    get('be-rotation').value = rot;
    get('be-rotation-val').textContent = rot + '°';

    el.querySelectorAll('.be-align-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.align === (block.align || 'center'));
    });
  }

  _updateLabels() {
    const el = this.panel;
    const L = k => t(this._lang, k);
    const setL = (id, key) => { const e = el.querySelector(`#${id}`); if (e) e.textContent = L(key); };
    setL('be-lbl-ocr', 'lblOcrText');
    setL('be-lbl-trans', 'lblTransText');
    setL('be-lbl-font', 'lblFontFamily');
    setL('be-lbl-size', 'lblFontSize');
    setL('be-lbl-auto', 'lblFontAuto');
    setL('be-lbl-color', 'lblColor');
    setL('be-lbl-bg', 'lblBgColor');
    setL('be-lbl-opacity', 'lblOpacity');
    setL('be-lbl-rotation', 'lblRotation');
    setL('be-lbl-align', 'lblAlign');
  }
}
