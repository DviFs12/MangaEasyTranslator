/**
 * ui.js — v7
 *
 * Mudanças vs v6:
 *  - Removidas referências a balloonType e ballBadge (balões extintos)
 *  - renderBlocks: card mais limpo, sem ícone/badge de balão
 *  - updateBlockCard: corrigido — não sobrescreve textarea em foco
 *  - highlightBlock: scroll suavizado só se fora da viewport
 */

let _tt;
export function toast(msg, type = 'info', ms = 3200) {
  const el = document.getElementById('toast'); if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.remove('show'), ms);
}

export function showLoading(msg = 'Processando…', pct = 0, sub = '') {
  document.getElementById('loading-overlay').style.display = 'flex';
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
  document.getElementById('loading-overlay').style.display = 'none';
}

export function setStep(n) {
  document.querySelectorAll('.step').forEach(el => {
    const s = +el.dataset.step;
    el.classList.toggle('active', s === n);
    el.classList.toggle('done', s < n);
  });
}

export function setStatus(id, msg, type = 'info') {
  const el = document.getElementById(id); if (!el) return;
  el.textContent = msg;
  el.className = `status-box ${type}`;
  el.classList.remove('hidden');
}
export function clearStatus(id) {
  document.getElementById(id)?.classList.add('hidden');
}

export function renderBlocks(blocks, cbs) {
  const list  = document.getElementById('blocks-list');
  const badge = document.getElementById('block-count');
  if (!list) return;
  if (badge) badge.textContent = blocks.length;

  list.innerHTML = '';

  if (!blocks.length) {
    list.innerHTML = '<p class="empty-hint">Adicione blocos (+) ou rode o OCR.</p>';
    return;
  }

  for (const b of blocks) {
    const card = document.createElement('div');
    card.className = 'block-card' +
      (b.applied ? ' applied' : '') +
      (b.manual  ? ' manual'  : '');
    card.dataset.id = b.id;

    const confColor = b.confidence > 70 ? '#2d9e5f' : b.confidence > 40 ? '#e07d10' : '#c0392b';
    const manBadge  = b.manual ? `<span class="block-manual-badge">✎ manual</span>` : '';
    const numLabel  = b.id.split('-')[1] ?? b.id;

    card.innerHTML = `
      <div class="block-header">
        <span class="block-num">#${numLabel}</span>
        ${manBadge}
        <span class="block-conf" style="color:${confColor}">${b.confidence}%</span>
        <div class="block-actions">
          <button class="block-action-btn vis-btn"     title="Visibilidade">${b.visible ? '👁' : '🙈'}</button>
          <button class="block-action-btn clean-btn"   title="Limpar texto (inteligente)">🧹</button>
          <button class="block-action-btn inpaint-btn" title="Inpaint automático">🪄</button>
          <button class="block-action-btn reocr-btn"   title="Re-OCR">🔄</button>
          <button class="block-action-btn danger del-btn" title="Remover">🗑</button>
        </div>
      </div>
      <label class="tool-label" style="margin-top:4px">Texto original (editável)</label>
      <textarea class="block-original-edit" rows="2" placeholder="Digite ou faça OCR…">${_esc(b.text)}</textarea>
      <label class="tool-label">Tradução</label>
      <textarea class="block-translation" rows="2" placeholder="Tradução…">${_esc(b.translation || '')}</textarea>
      <div class="block-status ${b.translating ? 'translating' : b.translation ? 'done' : ''}">
        ${b.translating ? '⏳ Traduzindo…' : b.translation ? '✓ Traduzido' : '· Aguardando'}
      </div>
      <button class="block-apply-btn">✓ Aplicar Tradução</button>
    `;

    card.querySelector('.vis-btn').onclick     = (e) => { e.stopPropagation(); cbs.onToggleVis(b.id); };
    card.querySelector('.clean-btn').onclick   = (e) => { e.stopPropagation(); cbs.onClean(b.id); };
    card.querySelector('.inpaint-btn').onclick = (e) => { e.stopPropagation(); cbs.onInpaint(b.id); };
    card.querySelector('.reocr-btn').onclick   = (e) => { e.stopPropagation(); cbs.onReOCR(b.id); };
    card.querySelector('.del-btn').onclick     = (e) => { e.stopPropagation(); cbs.onDelete(b.id); };

    card.querySelector('.block-apply-btn').onclick = (e) => {
      e.stopPropagation();
      cbs.onApply(b.id, card.querySelector('.block-translation').value.trim());
    };
    card.querySelector('.block-original-edit').addEventListener('input', (e) => {
      cbs.onOcrEdit(b.id, e.target.value);
    });
    card.querySelector('.block-translation').addEventListener('input', (e) => {
      cbs.onTranslationEdit(b.id, e.target.value);
    });

    card.addEventListener('click', (e) => {
      if (e.target.closest('button, textarea')) return;
      cbs.onSelect(b.id);
    });

    list.appendChild(card);
  }
}

export function updateBlockCard(block) {
  const card = document.querySelector(`.block-card[data-id="${block.id}"]`);
  if (!card) return;

  const taTrans = card.querySelector('.block-translation');
  const st      = card.querySelector('.block-status');
  const oeText  = card.querySelector('.block-original-edit');

  // Só atualiza textarea se não estiver em foco (evita sobrescrever digitação)
  if (oeText && block.text && document.activeElement !== oeText && oeText.value !== block.text)
    oeText.value = block.text;

  if (taTrans && block.translation && document.activeElement !== taTrans && taTrans.value !== block.translation)
    taTrans.value = block.translation;

  if (st) {
    st.className = `block-status ${block.translating ? 'translating' : block.translation ? 'done' : ''}`;
    st.textContent = block.translating ? '⏳ Traduzindo…' : block.translation ? '✓ Traduzido' : '· Aguardando';
  }
}

export function highlightBlock(id) {
  document.querySelectorAll('.block-card').forEach(c => c.classList.remove('selected'));
  const c = document.querySelector(`.block-card[data-id="${id}"]`);
  if (!c) return;
  c.classList.add('selected');
  // Só faz scroll se o card não estiver visível
  const rect = c.getBoundingClientRect();
  const inView = rect.top >= 0 && rect.bottom <= window.innerHeight;
  if (!inView) c.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function _esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
