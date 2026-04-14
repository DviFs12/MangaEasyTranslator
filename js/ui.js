/**
 * ui.js — Utilitários de UI: toast, loading, steps, blocks list.
 */

// ── Toast ──────────────────────────────────────────────────────
let _toastTimer;
export function toast(msg, type = 'info', ms = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `toast show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── Loading ────────────────────────────────────────────────────
export function showLoading(msg = 'Processando…', pct = 0, sub = '') {
  const ov  = document.getElementById('loading-overlay');
  const msg_el = document.getElementById('loading-msg');
  const sub_el = document.getElementById('loading-sub');
  const fill   = document.getElementById('progress-fill');
  if (ov)    ov.style.display = 'flex';
  if (msg_el) msg_el.textContent = msg;
  if (sub_el) sub_el.textContent = sub;
  if (fill)   fill.style.width   = `${pct}%`;
}
export function updateLoading(msg, pct, sub = '') {
  const msg_el = document.getElementById('loading-msg');
  const sub_el = document.getElementById('loading-sub');
  const fill   = document.getElementById('progress-fill');
  if (msg_el) msg_el.textContent = msg;
  if (sub_el) sub_el.textContent = sub;
  if (fill)   fill.style.width   = `${pct}%`;
}
export function hideLoading() {
  const ov = document.getElementById('loading-overlay');
  if (ov) ov.style.display = 'none';
}

// ── Steps ──────────────────────────────────────────────────────
export function setStep(n) {
  document.querySelectorAll('.step').forEach(el => {
    const s = +el.dataset.step;
    el.classList.toggle('active', s === n);
    el.classList.toggle('done',   s < n);
  });
}

// ── Status boxes ───────────────────────────────────────────────
export function setStatus(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className   = `status-box ${type}`;
  el.classList.remove('hidden');
}
export function clearStatus(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('hidden');
}

// ── Blocks list ────────────────────────────────────────────────
export function renderBlocks(blocks, callbacks) {
  const list  = document.getElementById('blocks-list');
  const badge = document.getElementById('block-count');
  if (!list) return;

  if (badge) badge.textContent = blocks.length;
  list.innerHTML = '';

  if (!blocks.length) {
    list.innerHTML = '<p class="empty-hint">Nenhum bloco detectado ainda.</p>';
    return;
  }

  for (const b of blocks) {
    const card = document.createElement('div');
    card.className = 'block-card' + (b.applied ? ' applied' : '');
    card.dataset.id = b.id;

    const confColor = b.confidence > 70 ? '#2d9e5f' : b.confidence > 40 ? '#e07d10' : '#c0392b';

    card.innerHTML = `
      <div class="block-header">
        <span class="block-num">#${b.id.split('-')[1]}</span>
        <span class="block-conf" style="color:${confColor}">${b.confidence}%</span>
        <div class="block-actions">
          <button class="block-action-btn vis-btn" title="Mostrar/ocultar bbox">${b.visible ? '👁' : '🙈'}</button>
          <button class="block-action-btn erase-btn" title="Apagar texto no canvas">🖌</button>
          <button class="block-action-btn del btn-del" title="Remover bloco">🗑</button>
        </div>
      </div>
      <div class="block-original">${esc(b.text)}</div>
      <textarea class="block-translation" rows="2" placeholder="Tradução...">${esc(b.translation || '')}</textarea>
      <div class="block-status ${b.translating ? 'translating' : b.translation ? 'done' : ''}">
        ${b.translating ? '⏳ Traduzindo…' : b.translation ? '✓ Traduzido' : '· Aguardando'}
      </div>
      <button class="block-apply-btn">✓ Aplicar Tradução</button>
    `;

    card.querySelector('.vis-btn').onclick    = (e) => { e.stopPropagation(); callbacks.onToggleVis(b.id); };
    card.querySelector('.erase-btn').onclick  = (e) => { e.stopPropagation(); callbacks.onErase(b.id); };
    card.querySelector('.del.btn-del').onclick = (e) => { e.stopPropagation(); callbacks.onDelete(b.id); };
    card.querySelector('.block-apply-btn').onclick = (e) => {
      e.stopPropagation();
      const ta = card.querySelector('.block-translation');
      callbacks.onApply(b.id, ta.value.trim());
    };
    card.querySelector('.block-translation').addEventListener('input', (e) => {
      callbacks.onTranslationEdit(b.id, e.target.value);
    });
    card.onclick = () => callbacks.onSelect(b.id);

    list.appendChild(card);
  }
}

export function updateBlockCard(block) {
  const card = document.querySelector(`.block-card[data-id="${block.id}"]`);
  if (!card) return;
  const ta  = card.querySelector('.block-translation');
  const st  = card.querySelector('.block-status');
  if (ta && block.translation && ta.value !== block.translation) ta.value = block.translation;
  if (st) {
    st.className   = `block-status ${block.translating ? 'translating' : block.translation ? 'done' : ''}`;
    st.textContent = block.translating ? '⏳ Traduzindo…' : block.translation ? '✓ Traduzido' : '· Aguardando';
  }
}

export function highlightBlock(id) {
  document.querySelectorAll('.block-card').forEach(c => c.classList.remove('selected'));
  const c = document.querySelector(`.block-card[data-id="${id}"]`);
  if (c) { c.classList.add('selected'); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
