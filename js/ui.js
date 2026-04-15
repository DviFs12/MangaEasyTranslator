/**
 * ui.js — v4
 * Adiciona:
 *  • Indicador de "cobrindo arte" (aviso de placement) por bloco
 *  • Botão de OCR manual por bloco (reabre OCR só da região)
 */

// ── Toast ──────────────────────────────────────────────
let _toastTimer;
export function toast(msg, type = 'info', ms = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className   = `toast show ${type}`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ── Loading ────────────────────────────────────────────
export function showLoading(msg = 'Processando…', pct = 0, sub = '') {
  const ov = document.getElementById('loading-overlay');
  if (ov) ov.style.display = 'flex';
  updateLoading(msg, pct, sub);
}
export function updateLoading(msg, pct, sub = '') {
  const m = document.getElementById('loading-msg');
  const s = document.getElementById('loading-sub');
  const f = document.getElementById('progress-fill');
  if (m) m.textContent = msg;
  if (s) s.textContent = sub;
  if (f) f.style.width = `${Math.round(pct)}%`;
}
export function hideLoading() {
  const ov = document.getElementById('loading-overlay');
  if (ov) ov.style.display = 'none';
}

// ── Steps ──────────────────────────────────────────────
export function setStep(n) {
  document.querySelectorAll('.step').forEach(el => {
    const s = +el.dataset.step;
    el.classList.toggle('active', s === n);
    el.classList.toggle('done',   s < n);
  });
}

// ── Status ─────────────────────────────────────────────
export function setStatus(id, msg, type = 'info') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg; el.className = `status-box ${type}`; el.classList.remove('hidden');
}
export function clearStatus(id) { document.getElementById(id)?.classList.add('hidden'); }

// ── Blocks list ────────────────────────────────────────
export function renderBlocks(blocks, callbacks) {
  const list  = document.getElementById('blocks-list');
  const badge = document.getElementById('block-count');
  if (!list) return;
  if (badge) badge.textContent = blocks.length;
  list.innerHTML = '';

  if (!blocks.length) {
    list.innerHTML = '<p class="empty-hint">Nenhum bloco detectado ainda.</p>'; return;
  }

  for (const b of blocks) {
    const card = document.createElement('div');
    card.className = 'block-card' + (b.applied ? ' applied' : '');
    card.dataset.id = b.id;

    const confColor = b.confidence > 70 ? '#2d9e5f' : b.confidence > 40 ? '#e07d10' : '#c0392b';
    const manualBadge = b.manual ? '<span class="block-badge-manual">✎</span>' : '';

    card.innerHTML = `
      <div class="block-header">
        <span class="block-num">#${b.id.split('-')[1]}</span>
        ${manualBadge}
        <span class="block-conf" style="color:${confColor}">${b.confidence}%</span>
        <div class="block-actions">
          <button class="block-action-btn vis-btn"   title="Mostrar/ocultar">${b.visible ? '👁' : '🙈'}</button>
          <button class="block-action-btn erase-btn" title="Apagar texto">🖌</button>
          <button class="block-action-btn reocr-btn" title="Re-OCR nesta região">🔄</button>
          <button class="block-action-btn del danger"title="Remover">🗑</button>
        </div>
      </div>
      <div class="block-original">${_esc(b.text)}</div>
      <textarea class="block-translation" rows="2" placeholder="Tradução…">${_esc(b.translation||'')}</textarea>
      <div class="block-status ${b.translating?'translating':b.translation?'done':''}">
        ${b.translating ? '⏳ Traduzindo…' : b.translation ? '✓ Traduzido' : '· Aguardando'}
      </div>
      ${b.placementWarning ? `<div class="block-warning">⚠ Pode cobrir arte importante</div>` : ''}
      <button class="block-apply-btn">✓ Aplicar Tradução</button>
    `;

    card.querySelector('.vis-btn').onclick    = (e) => { e.stopPropagation(); callbacks.onToggleVis(b.id); };
    card.querySelector('.erase-btn').onclick  = (e) => { e.stopPropagation(); callbacks.onErase(b.id); };
    card.querySelector('.reocr-btn').onclick  = (e) => { e.stopPropagation(); callbacks.onReOCR(b.id); };
    card.querySelector('.del').onclick        = (e) => { e.stopPropagation(); callbacks.onDelete(b.id); };
    card.querySelector('.block-apply-btn').onclick = (e) => {
      e.stopPropagation();
      callbacks.onApply(b.id, card.querySelector('.block-translation').value.trim());
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
  const ta = card.querySelector('.block-translation');
  const st = card.querySelector('.block-status');
  if (ta && block.translation && ta.value !== block.translation) ta.value = block.translation;
  if (st) {
    st.className   = `block-status ${block.translating?'translating':block.translation?'done':''}`;
    st.textContent = block.translating ? '⏳ Traduzindo…' : block.translation ? '✓ Traduzido' : '· Aguardando';
  }
}

export function highlightBlock(id) {
  document.querySelectorAll('.block-card').forEach(c => c.classList.remove('selected'));
  const c = document.querySelector(`.block-card[data-id="${id}"]`);
  if (c) { c.classList.add('selected'); c.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

function _esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
