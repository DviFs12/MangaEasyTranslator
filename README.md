# MangaEasyTranslator v3

Aplicação web **100% frontend** para tradução de páginas de mangá.  
Compatível com GitHub Pages — sem backend, sem login, sem custos.

## Funcionalidades

- Upload de imagem (drag & drop ou clique)
- OCR automático com Tesseract.js v4 (Japonês, Inglês, Chinês, Coreano)
- Tradução automática com fallback: Google → MyMemory → LibreTranslate
- **6 ferramentas de edição:** Pincel, Borracha, Blur, Fill, Clone Stamp, Seleção
- Caixas de texto draggable + resizável + **rotacionável**
- Seleção automática de fonte por contexto (Bangers, Anton, Oswald, etc.)
- Preview em tempo real via requestAnimationFrame (sem travar a UI)
- Pan/zoom fluido com scroll wheel + arrastar
- Undo/Redo (25 níveis)
- Exportar PNG final

## GitHub Pages

1. Faça upload/fork deste projeto para um repositório GitHub
2. Vá em **Settings → Pages → Source: main branch, / (root)**
3. Acesse `https://seu-usuario.github.io/nome-do-repo/`

## Rodar localmente

```bash
# Qualquer servidor HTTP estático funciona
npx serve .
# ou
python3 -m http.server 8080
```

> ⚠️ Não abra `index.html` diretamente como `file://` — ES Modules exigem HTTP.

## Atalhos de Teclado

| Tecla | Ação |
|-------|------|
| `B` | Pincel |
| `E` | Borracha |
| `U` | Blur |
| `F` | Fill (balde) |
| `C` | Clone Stamp |
| `S` | Seleção retangular |
| `+` / `-` | Zoom in/out |
| `0` | Ajustar à tela |
| `1` | Zoom 100% |
| `Ctrl+Z` | Desfazer |
| `Ctrl+Y` | Refazer |
| `Delete` | Remover caixa selecionada |
| `Esc` | Cancelar ferramenta / deselecionar |

## Estrutura

```
MangaEasyTranslator/
├── index.html
├── style.css
└── js/
    ├── app.js          — Orquestrador
    ├── ocr.js          — Tesseract.js v4 (corrigido)
    ├── translate.js    — Tradução multi-serviço com cache
    ├── editor.js       — Canvas editor: pan/zoom/ferramentas/undo
    ├── textManager.js  — Caixas de texto DOM + preview rAF
    ├── fontManager.js  — Catálogo e seleção automática de fontes
    └── ui.js           — Toast, loading, steps, blocks panel
```
