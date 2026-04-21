/**
 * state/i18n.js — MET10
 * Bilingual strings (pt / en). Pure data, no DOM.
 */

export const STRINGS = {
  pt: {
    appTitle: 'MangaEasyTranslator',

    // Toolbar
    toolSelect: 'Selecionar',
    toolLasso: 'Laço',
    toolStroke: 'Linha OCR',
    toolBrush: 'Pincel',
    toolEraser: 'Borracha',
    toolClone: 'Clone',

    // Actions on selection
    actionOcr: 'OCR',
    actionClean: 'Limpar',
    actionInpaint: 'Inpaint',
    actionTranslate: 'Traduzir',
    actionText: 'Texto',
    actionApply: 'Aplicar',

    // Header buttons
    btnNew: '↺ Nova',
    btnSave: '💾 Salvar',
    btnLoad: '📂 Carregar',
    btnExport: '⬇ Exportar PNG',
    btnOcrAll: '🔍 OCR Completo',
    btnTransAll: '🌐 Traduzir Todos',
    btnUndo: 'Desfazer',
    btnRedo: 'Refazer',

    // Panels
    secOcr: '🔍 OCR',
    secTranslate: '🌐 Tradução',
    secTools: '🖌 Ferramentas',
    secBlocks: '📝 Caixas de Texto',

    // Labels
    lblSrcLang: 'Idioma de origem',
    lblDstLang: 'Idioma de destino',
    lblFontSize: 'Tamanho',
    lblFontAuto: 'Auto',
    lblFontFamily: 'Fonte',
    lblColor: 'Cor do texto',
    lblBgColor: 'Fundo',
    lblOpacity: 'Opacidade',
    lblRotation: 'Rotação',
    lblAlign: 'Alinhamento',
    lblOcrText: 'Texto OCR',
    lblTransText: 'Tradução',
    lblThreshold: 'Limiar',
    lblBrushSize: 'Tamanho',

    // Status
    statusDrop: 'Arraste uma imagem ou clique para abrir',
    statusLoading: 'Carregando…',
    statusOcr: 'Executando OCR…',
    statusTranslating: 'Traduzindo…',
    statusInpainting: 'Inpainting…',
    statusReady: 'Pronto',
    statusNoBlocks: 'Nenhuma caixa ainda.',
    statusAutosaved: 'Salvo automaticamente',

    // Toasts
    toastLoaded: 'Imagem carregada',
    toastOcrDone: (n) => `OCR concluído — ${n} bloco(s)`,
    toastTransDone: 'Tradução concluída',
    toastInpaintDone: 'Inpaint concluído',
    toastSaved: 'Projeto salvo',
    toastProjectLoaded: 'Projeto carregado',
    toastExported: 'Imagem exportada',
    toastNoText: 'Nenhum texto detectado',
    toastError: (m) => `Erro: ${m}`,

    // OCR psm
    psmAuto: 'Automático (PSM 11)',
    psmBlock: 'Bloco (PSM 6)',
    psmLine: 'Linha (PSM 7)',
    psmWord: 'Palavra (PSM 8)',

    // Block card
    blockApply: 'Aplicar',
    blockApplied: '✓ Aplicado',
    blockClean: 'Limpar',
    blockDelete: 'Remover',
    blockOcr: 'OCR',
    blockInpaint: 'Inpaint',

    // Confirm
    confirmNew: 'Isso vai limpar o projeto atual. Continuar?',
    confirmDeleteAll: 'Remover todas as caixas?',

    // Autosave
    autosaveFound: 'Projeto autossalvo encontrado. Restaurar?',
  },

  en: {
    appTitle: 'MangaEasyTranslator',

    toolSelect: 'Select',
    toolLasso: 'Lasso',
    toolStroke: 'Line OCR',
    toolBrush: 'Brush',
    toolEraser: 'Eraser',
    toolClone: 'Clone',

    actionOcr: 'OCR',
    actionClean: 'Clean',
    actionInpaint: 'Inpaint',
    actionTranslate: 'Translate',
    actionText: 'Text',
    actionApply: 'Apply',

    btnNew: '↺ New',
    btnSave: '💾 Save',
    btnLoad: '📂 Load',
    btnExport: '⬇ Export PNG',
    btnOcrAll: '🔍 Full OCR',
    btnTransAll: '🌐 Translate All',
    btnUndo: 'Undo',
    btnRedo: 'Redo',

    secOcr: '🔍 OCR',
    secTranslate: '🌐 Translation',
    secTools: '🖌 Tools',
    secBlocks: '📝 Text Boxes',

    lblSrcLang: 'Source language',
    lblDstLang: 'Target language',
    lblFontSize: 'Size',
    lblFontAuto: 'Auto',
    lblFontFamily: 'Font',
    lblColor: 'Text color',
    lblBgColor: 'Background',
    lblOpacity: 'Opacity',
    lblRotation: 'Rotation',
    lblAlign: 'Align',
    lblOcrText: 'OCR Text',
    lblTransText: 'Translation',
    lblThreshold: 'Threshold',
    lblBrushSize: 'Size',

    statusDrop: 'Drop an image or click to open',
    statusLoading: 'Loading…',
    statusOcr: 'Running OCR…',
    statusTranslating: 'Translating…',
    statusInpainting: 'Inpainting…',
    statusReady: 'Ready',
    statusNoBlocks: 'No boxes yet.',
    statusAutosaved: 'Auto-saved',

    toastLoaded: 'Image loaded',
    toastOcrDone: (n) => `OCR done — ${n} block(s)`,
    toastTransDone: 'Translation done',
    toastInpaintDone: 'Inpaint done',
    toastSaved: 'Project saved',
    toastProjectLoaded: 'Project loaded',
    toastExported: 'Image exported',
    toastNoText: 'No text detected',
    toastError: (m) => `Error: ${m}`,

    psmAuto: 'Auto (PSM 11)',
    psmBlock: 'Block (PSM 6)',
    psmLine: 'Line (PSM 7)',
    psmWord: 'Word (PSM 8)',

    blockApply: 'Apply',
    blockApplied: '✓ Applied',
    blockClean: 'Clean',
    blockDelete: 'Remove',
    blockOcr: 'OCR',
    blockInpaint: 'Inpaint',

    confirmNew: 'This will clear the current project. Continue?',
    confirmDeleteAll: 'Remove all boxes?',

    autosaveFound: 'Autosaved project found. Restore?',
  },
};

export function t(lang, key, ...args) {
  const s = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
  return typeof s === 'function' ? s(...args) : s;
}
