/**
 * ui.js — Utilitários de interface: toast, loading, steps, blocks list.
 */

// ---- TOAST ----
let toastTimer = null;
export function showToast(msg, type = 'info', duration = 3000) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ---- LOADING ----
export function showLoading(msg = 'Processando...', pct = 0) {
  const overlay = document.getElementById('loading-overlay');
  const msgEl = document.getElementById('loading-msg');
  const fill = document.getElementById('progress-fill');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  if (msgEl) msgEl.textContent = msg;
  if (fill) fill.style.width = `${pct}%`;
}

export function updateLoading(msg, pct) {
  const msgEl = document.getElementById('loading-msg');
  const fill = document.getElementById('progress-fill');
  if (msgEl) msgEl.textContent = msg;
  if (fill) fill.style.width = `${pct}%`;
}

export function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) overlay.classList.add('hidden');
}

// ---- STEPS ----
export function setStep(n) {
  document.querySelectorAll('.step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('active', 'done');
    if (s === n) el.classList.add('active');
    else if (s < n) el.classList.add('done');
  });
}

// ---- STATUS BOXES ----
export function setStatus(elId, msg, type = 'info') {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = `status-box ${type}`;
  el.classList.remove('hidden');
}

export function hideStatus(elId) {
  const el = document.getElementById(elId);
  if (el) el.classList.add('hidden');
}

// ---- BLOCKS LIST (painel direito) ----
export function renderBlocksList(blocks, {
  onSelect,
  onToggleVisibility,
  onApplyTranslation,
  onDelete,
  onTranslationEdit,
}) {
  const list = document.getElementById('blocks-list');
  const countEl = document.getElementById('block-count');
  if (!list) return;

  list.innerHTML = '';
  if (countEl) countEl.textContent = blocks.length;

  if (blocks.length === 0) {
    list.innerHTML = '<p class="empty-hint">Nenhum texto detectado ainda.</p>';
    return;
  }

  for (const block of blocks) {
    const card = document.createElement('div');
    card.className = 'block-card';
    card.id = `card-${block.id}`;
    card.dataset.id = block.id;

    const confColor = block.confidence > 70 ? '#2a9d5c' :
                      block.confidence > 40 ? '#f4a261' : '#e63946';

    card.innerHTML = `
      <div class="block-header">
        <span class="block-badge">#${block.id.split('-')[1]}</span>
        <span style="font-size:0.7rem;color:${confColor};font-weight:700">${block.confidence}%</span>
        <div class="block-actions">
          <button class="block-btn vis-btn" title="${block.visible ? 'Ocultar bbox' : 'Mostrar bbox'}">
            ${block.visible ? '👁' : '🙈'}
          </button>
          <button class="block-btn erase-btn" title="Apagar texto original no canvas">🖌</button>
          <button class="block-btn danger del-btn" title="Remover bloco">🗑</button>
        </div>
      </div>
      <div class="block-original" title="Texto original">${escapeHtml(block.text)}</div>
      <textarea class="block-translation" placeholder="Tradução..." rows="2">${escapeHtml(block.translation || '')}</textarea>
      <div class="block-status ${getStatusClass(block)}">
        ${getStatusLabel(block)}
      </div>
      <button class="block-apply-btn" title="Inserir tradução no canvas">✓ Aplicar Tradução</button>
    `;

    // Events
    card.querySelector('.vis-btn').addEventListener('click', () => onToggleVisibility(block.id));
    card.querySelector('.erase-btn').addEventListener('click', () => {
      onSelect(block.id);
    });
    card.querySelector('.del-btn').addEventListener('click', () => onDelete(block.id));
    card.querySelector('.block-apply-btn').addEventListener('click', () => {
      const ta = card.querySelector('.block-translation');
      onApplyTranslation(block.id, ta.value.trim());
    });
    card.querySelector('.block-translation').addEventListener('input', (e) => {
      onTranslationEdit(block.id, e.target.value);
    });
    card.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA') return;
      onSelect(block.id);
    });

    list.appendChild(card);
  }
}

export function updateBlockCard(block) {
  const card = document.getElementById(`card-${block.id}`);
  if (!card) return;

  const ta = card.querySelector('.block-translation');
  if (ta && block.translation && ta.value !== block.translation) {
    ta.value = block.translation;
  }

  const status = card.querySelector('.block-status');
  if (status) {
    status.className = `block-status ${getStatusClass(block)}`;
    status.textContent = getStatusLabel(block);
  }
}

export function highlightBlockCard(id) {
  document.querySelectorAll('.block-card').forEach(c => c.classList.remove('selected'));
  const card = document.getElementById(`card-${id}`);
  if (card) {
    card.classList.add('selected');
    card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function getStatusClass(block) {
  if (block.translating) return 'translating';
  if (block.translation) return 'done';
  return '';
}

function getStatusLabel(block) {
  if (block.translating) return '⏳ Traduzindo...';
  if (block.translation) return '✓ Traduzido';
  return '· Aguardando tradução';
}

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
