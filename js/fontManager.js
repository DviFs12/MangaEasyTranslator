/**
 * fontManager.js — Catálogo de fontes para scanlation e seleção automática.
 */

export const FONTS = [
  { name: 'Bangers',          label: 'Bangers (Ação)',     style: 'action'    },
  { name: 'Anton',            label: 'Anton (Impacto)',    style: 'impact'    },
  { name: 'Bebas Neue',       label: 'Bebas Neue',         style: 'condensed' },
  { name: 'Oswald',           label: 'Oswald',             style: 'dialog'    },
  { name: 'Permanent Marker', label: 'Permanent Marker',   style: 'thought'   },
  { name: 'Comic Neue',       label: 'Comic Neue',         style: 'comic'     },
  { name: 'Nunito',           label: 'Nunito',             style: 'clean'     },
  { name: 'Arial',            label: 'Arial',              style: 'system'    },
];

/**
 * Seleciona a melhor fonte baseada no conteúdo do texto e área.
 * @param {{ text: string, bbox: {w:number, h:number} }} block
 * @returns {string} nome da fonte
 */
export function pickFont(block) {
  const { text, bbox } = block;
  const area  = bbox.w * bbox.h;
  const upper = text === text.toUpperCase() && /[A-Za-z]/.test(text);
  const shout = /[!！]{1,}/.test(text) || upper;
  const ellip = /\.{2,}|…/.test(text);
  const paren = text.startsWith('(') || text.startsWith('*');
  const long  = text.length > 55;
  const large = area > 18000;

  if (shout && !long)         return 'Bangers';
  if (large && !long)         return 'Anton';
  if (ellip || paren)         return 'Permanent Marker';
  if (long)                   return 'Comic Neue';
  return 'Oswald';            // default: clean dialog
}

/**
 * Calcula tamanho de fonte que preenche bem o bbox sem overflow.
 * @param {string} text
 * @param {{w:number,h:number}} bbox
 * @param {string} font
 * @returns {number} tamanho em px
 */
export function pickFontSize(text, bbox, font = 'Oswald') {
  const lines    = text.split('\n');
  const longest  = lines.reduce((a, b) => a.length > b.length ? a : b, '');
  const nLines   = Math.max(lines.length, 1);

  // Ratio largura-por-caracter varia por fonte
  const charW    = font === 'Bebas Neue' ? 0.44 : font === 'Bangers' ? 0.52 : 0.58;
  const lineH    = 1.35;

  const byWidth  = (bbox.w * 0.88) / Math.max(longest.length * charW, 1);
  const byHeight = (bbox.h * 0.88) / (nLines * lineH);

  return Math.max(9, Math.min(72, Math.floor(Math.min(byWidth, byHeight))));
}
