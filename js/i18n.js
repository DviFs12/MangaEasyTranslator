/**
 * i18n.js — v8
 *
 * Sistema simples de tradução PT-BR ↔ EN para a interface.
 * Uso: chamar applyLang(code) para trocar idioma em tempo real.
 * Elementos com data-i18n="chave" têm seu textContent substituído.
 * Elementos com data-i18n-title="chave" têm seu title substituído.
 * Elementos com data-i18n-placeholder="chave" têm seu placeholder substituído.
 */

export const LANGS = {
  pt: {
    // Header
    'save':            '💾 Salvar',
    'load':            '📂 Carregar',
    'new':             '↺ Nova',
    'export':          '⬇ Exportar PNG',
    // Steps
    'step-upload':     'Upload',
    'step-ocr':        'OCR',
    'step-translate':  'Tradução',
    'step-edit':       'Edição',
    'step-export':     'Exportar',
    // OCR section
    'sec-ocr':         '🔍 OCR',
    'lbl-src-lang':    'Idioma de origem',
    'lbl-ocr-mode':    'Modo OCR (PSM)',
    'btn-run-ocr':     '🔍 OCR Página',
    // Translation section
    'sec-translate':   '🌐 Tradução',
    'lbl-dst-lang':    'Idioma destino',
    'btn-translate':   '🌐 Traduzir Tudo',
    // Tools section
    'sec-tools':       '🛠 Ferramentas',
    'tool-brush':      '🖌 Pincel',
    'tool-eraser':     '⬜ Borracha',
    'tool-blur':       '💧 Blur',
    'tool-inpaint':    '🪄 Inpaint',
    'tool-fill':       '🪣 Fill',
    'tool-clone':      '🔁 Clone',
    'tool-selection':  '⬡ Seleção',
    'tool-lasso':      '🔵 Laço',
    'tool-stroke':     '📏 Linha OCR',
    'tool-textbox':    '📝 TextBox',
    // Layers
    'sec-layers':      '🗂 Camadas',
    'layer-base':      '🖼 Imagem Base',
    'layer-inpaint':   '🪄 Inpaint',
    'layer-text':      '📝 Texto',
    'layer-overlay':   '🔲 Boxes OCR',
    // Zoom
    'sec-zoom':        '🔭 Visualização',
    'btn-fit':         '⊡ Ajustar',
    'btn-zoom-reset':  '1:1',
    'tip-zoom':        '🖱 Scroll=zoom · Arrastar=mover · Alt+drag=pan',
    // Manual text
    'sec-manual-text': '✏ Texto Manual',
    'ph-new-text':     'Digite o texto...',
    'btn-add-text':    '+ Adicionar Caixa',
    // Box editor
    'sec-box-edit':    '📦 Editar Caixa',
    'lbl-ocr-text':    'Texto original (editável)',
    'ph-ocr-text':     'Digite ou faça OCR…',
    'lbl-final-text':  'Texto traduzido / final',
    'ph-final-text':   'Texto traduzido...',
    'lbl-font':        'Fonte',
    'lbl-size':        'Tam.',
    'lbl-auto':        'Auto',
    'lbl-color':       'Cor',
    'lbl-bg':          'Fundo',
    'lbl-opacity':     'Opac.',
    'lbl-align':       'Alinhamento',
    'lbl-rotation':    'Rotação',
    'btn-layout':      '⚙ Layout',
    'btn-inpaint-box': '🪄 Inpaint',
    'btn-copy-ocr':    '⬇ Usar OCR',
    'btn-ocr-box':     '🔍 Re-OCR',
    // Blocks panel
    'sec-blocks':      '📋 Blocos',
    'hint-blocks':     'Adicione blocos (+) ou rode o OCR.',
    'btn-add-manual':  '+',
    // Sel toolbar
    'btn-ocr-sel':     '🔍 OCR',
    // Lang toggle
    'btn-lang':        '🌐 EN',
    // OCR PSM options
    'psm-11':          '11 — Sparse (mangá)',
    'psm-3':           '3 — Auto',
    'psm-6':           '6 — Bloco único',
    'psm-7':           '7 — Linha única',
    // Drop zone
    'drop-title':      'Arraste uma página de mangá',
    'drop-sub':        'ou clique para selecionar',
    'btn-select-file': 'Selecionar Imagem',
    'drop-hint1':      'JPG · PNG · WebP',
    'drop-hint2':      'ou',
    'drop-link':       'carregar projeto .met',
  },

  en: {
    // Header
    'save':            '💾 Save',
    'load':            '📂 Load',
    'new':             '↺ New',
    'export':          '⬇ Export PNG',
    // Steps
    'step-upload':     'Upload',
    'step-ocr':        'OCR',
    'step-translate':  'Translate',
    'step-edit':       'Edit',
    'step-export':     'Export',
    // OCR section
    'sec-ocr':         '🔍 OCR',
    'lbl-src-lang':    'Source language',
    'lbl-ocr-mode':    'OCR Mode (PSM)',
    'btn-run-ocr':     '🔍 OCR Page',
    // Translation section
    'sec-translate':   '🌐 Translation',
    'lbl-dst-lang':    'Target language',
    'btn-translate':   '🌐 Translate All',
    // Tools section
    'sec-tools':       '🛠 Tools',
    'tool-brush':      '🖌 Brush',
    'tool-eraser':     '⬜ Eraser',
    'tool-blur':       '💧 Blur',
    'tool-inpaint':    '🪄 Inpaint',
    'tool-fill':       '🪣 Fill',
    'tool-clone':      '🔁 Clone',
    'tool-selection':  '⬡ Select',
    'tool-lasso':      '🔵 Lasso',
    'tool-stroke':     '📏 Line OCR',
    'tool-textbox':    '📝 TextBox',
    // Layers
    'sec-layers':      '🗂 Layers',
    'layer-base':      '🖼 Base Image',
    'layer-inpaint':   '🪄 Inpaint',
    'layer-text':      '📝 Text',
    'layer-overlay':   '🔲 OCR Boxes',
    // Zoom
    'sec-zoom':        '🔭 View',
    'btn-fit':         '⊡ Fit',
    'btn-zoom-reset':  '1:1',
    'tip-zoom':        '🖱 Scroll=zoom · Drag=pan · Alt+drag=pan',
    // Manual text
    'sec-manual-text': '✏ Manual Text',
    'ph-new-text':     'Type text...',
    'btn-add-text':    '+ Add Box',
    // Box editor
    'sec-box-edit':    '📦 Edit Box',
    'lbl-ocr-text':    'Original text (editable)',
    'ph-ocr-text':     'Type or run OCR…',
    'lbl-final-text':  'Translated / final text',
    'ph-final-text':   'Translated text...',
    'lbl-font':        'Font',
    'lbl-size':        'Size',
    'lbl-auto':        'Auto',
    'lbl-color':       'Color',
    'lbl-bg':          'BG',
    'lbl-opacity':     'Opac.',
    'lbl-align':       'Alignment',
    'lbl-rotation':    'Rotation',
    'btn-layout':      '⚙ Layout',
    'btn-inpaint-box': '🪄 Inpaint',
    'btn-copy-ocr':    '⬇ Use OCR',
    'btn-ocr-box':     '🔍 Re-OCR',
    // Blocks panel
    'sec-blocks':      '📋 Blocks',
    'hint-blocks':     'Add blocks (+) or run OCR.',
    'btn-add-manual':  '+',
    // Sel toolbar
    'btn-ocr-sel':     '🔍 OCR',
    // Lang toggle
    'btn-lang':        '🌐 PT',
    // OCR PSM options
    'psm-11':          '11 — Sparse (manga)',
    'psm-3':           '3 — Auto',
    'psm-6':           '6 — Single block',
    'psm-7':           '7 — Single line',
    // Drop zone
    'drop-title':      'Drop a manga page here',
    'drop-sub':        'or click to select',
    'btn-select-file': 'Select Image',
    'drop-hint1':      'JPG · PNG · WebP',
    'drop-hint2':      'or',
    'drop-link':       'load project .met',
  },
};

let _current = 'pt';

export function currentLang() { return _current; }

export function applyLang(code) {
  _current = code;
  const dict = LANGS[code] ?? LANGS.pt;

  // data-i18n → textContent
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (dict[key] != null) el.textContent = dict[key];
  });

  // data-i18n-title → title attribute
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (dict[key] != null) el.title = dict[key];
  });

  // data-i18n-placeholder → placeholder attribute
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    if (dict[key] != null) el.placeholder = dict[key];
  });

  // html lang attribute
  document.documentElement.lang = code === 'en' ? 'en' : 'pt-BR';

  // Persist preference
  try { localStorage.setItem('met_lang', code); } catch (_) {}
}

export function initLang() {
  let saved = 'pt';
  try { saved = localStorage.getItem('met_lang') || 'pt'; } catch (_) {}
  applyLang(saved);
  return saved;
}

export function toggleLang() {
  const next = _current === 'pt' ? 'en' : 'pt';
  applyLang(next);
  return next;
}

/** Returns translated string directly (for use in JS toasts, tips, etc.) */
export function t(key) {
  return LANGS[_current]?.[key] ?? LANGS.pt[key] ?? key;
}
