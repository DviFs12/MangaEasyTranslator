/**
 * ui/components.js — MET10
 * Reusable UI primitives: toast notifications, loading overlay,
 * progress bar. No business logic.
 */

// ── Toast ──────────────────────────────────────────────────────────────────

let _toastEl = null;
let _toastTimer = null;

export function toast(msg, type = 'info', duration = 3000) {
  if (!_toastEl) {
    _toastEl = document.createElement('div');
    _toastEl.id = 'met-toast';
    document.body.appendChild(_toastEl);
  }
  _toastEl.textContent = msg;
  _toastEl.className = `met-toast met-toast-${type} met-toast-visible`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { _toastEl.classList.remove('met-toast-visible'); }, duration);
}

// ── Loading overlay ────────────────────────────────────────────────────────

let _loadEl = null;
let _loadLabel = null;
let _loadBar = null;

function _ensureLoad() {
  if (_loadEl) return;
  _loadEl = document.createElement('div');
  _loadEl.id = 'met-loading';
  _loadEl.innerHTML = `
    <div class="met-loading-inner">
      <div class="met-spinner"></div>
      <div class="met-loading-label"></div>
      <div class="met-loading-track"><div class="met-loading-bar"></div></div>
    </div>
  `;
  document.body.appendChild(_loadEl);
  _loadLabel = _loadEl.querySelector('.met-loading-label');
  _loadBar   = _loadEl.querySelector('.met-loading-bar');
}

export function showLoading(msg = '', progress = 0) {
  _ensureLoad();
  _loadLabel.textContent = msg;
  _loadBar.style.width = `${progress}%`;
  _loadEl.classList.add('visible');
}

export function updateLoading(progress, msg) {
  if (!_loadEl) return;
  if (msg !== undefined) _loadLabel.textContent = msg;
  _loadBar.style.width = `${progress}%`;
}

export function hideLoading() {
  _loadEl?.classList.remove('visible');
}

// ── Confirm dialog ─────────────────────────────────────────────────────────

export function confirm(msg) {
  return window.confirm(msg);
}

// ── DOM helpers ────────────────────────────────────────────────────────────

export const $ = id => document.getElementById(id);
export const $$ = sel => document.querySelectorAll(sel);

export function setAttr(el, attrs) {
  if (!el) return;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'disabled') el.disabled = v;
    else if (k === 'textContent') el.textContent = v;
    else el.setAttribute(k, v);
  }
}

export function setHidden(el, hidden) {
  if (!el) return;
  el.classList.toggle('hidden', hidden);
}

export function setValue(el, val) {
  if (!el) return;
  el.value = val;
}

export function getValue(el) {
  return el?.value;
}
