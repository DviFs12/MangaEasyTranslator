# MangaEasyTranslator

Uma aplicação web **100% frontend** para tradução de páginas de mangá — sem backend, sem login, sem custos.

🔗 **Demo:** `https://seu-usuario.github.io/MangaEasyTranslator/`

---

## ✨ Funcionalidades

| Feature | Status |
|---------|--------|
| Upload de imagem (drag & drop ou clique) | ✅ |
| OCR automático (Tesseract.js) | ✅ |
| Suporte a Japonês, Inglês, Chinês, Coreano | ✅ |
| Tradução automática com fallback | ✅ |
| Pincel de apagar texto (branco/blur/clone) | ✅ |
| Inserção de texto traduzido | ✅ |
| Texto draggable + resizável | ✅ |
| Controle de fonte, cor, tamanho | ✅ |
| Zoom e visualização | ✅ |
| Undo/Desfazer | ✅ |
| Exportar PNG final | ✅ |
| Atalhos de teclado | ✅ |

---

## 🚀 Como usar no GitHub Pages

### Opção 1: Direto no GitHub

1. Faça fork ou upload desta pasta para um repositório GitHub
2. Vá em **Settings → Pages**
3. Em **Source**, selecione `main` branch e pasta `/root`
4. Clique **Save**
5. Aguarde ~1 minuto e acesse `https://seu-usuario.github.io/nome-do-repo/`

### Opção 2: Localmente

```bash
# Qualquer servidor HTTP estático serve
npx serve .
# ou
python3 -m http.server 8080
# ou
php -S localhost:8080
```

> ⚠️ **Não abra o `index.html` diretamente** como arquivo (`file://`) — os ES Modules requerem um servidor HTTP.

---

## 🔧 Decisões Técnicas

### OCR: Tesseract.js
- Roda 100% no browser via WebAssembly
- Sem necessidade de chave ou backend
- Suporta japonês, inglês, chinês, coreano
- Dados de idioma baixados sob demanda do CDN

### Tradução: Múltiplos serviços + fallback automático
1. **Google Translate** (endpoint não-oficial via `translate.googleapis.com`) — mais rápido
2. **MyMemory** — fallback gratuito, 5000 chars/dia sem chave
3. **LibreTranslate** — instâncias públicas, fallback final

Cache em memória evita requisições duplicadas.

### Editor de Canvas
- `<canvas>` nativo para renderização da imagem e pincel
- Canvas overlay separado para bounding boxes (não afeta a imagem)
- Div layer para textos (permite interatividade sem re-renderizar o canvas)
- Exportação combina tudo em um canvas de saída

### Módulos ES
- Código dividido em 5 módulos: `app.js`, `ocr.js`, `translate.js`, `editor.js`, `textManager.js`, `ui.js`
- Sem bundler necessário — browsers modernos suportam `type="module"` nativamente

---

## ⌨️ Atalhos de Teclado

| Tecla | Ação |
|-------|------|
| `B` | Ativar/desativar pincel |
| `+` / `-` | Zoom in/out |
| `Ctrl+Z` | Desfazer |
| `Delete` | Remover texto selecionado |
| `Escape` | Desselecionar / sair do pincel |

---

## 🔮 Melhorias Futuras

- [ ] **Detecção de orientação** de texto vertical (furigana, onomatopeias)
- [ ] **Segmentação de balões** (detectar contornos dos speech bubbles)
- [ ] **Modelo OCR offline para japonês** mais preciso (EasyOCR via ONNX)
- [ ] **Auto-layout** — ajustar tamanho de fonte para caber no balão
- [ ] **Modo batch** — processar múltiplas páginas
- [ ] **Suporte a WebP/AVIF** de saída
- [ ] **Tema escuro**
- [ ] **Plugin de integração** com DeepL (requer chave do usuário)

---

## 📁 Estrutura

```
MangaEasyTranslator/
├── index.html          # HTML principal
├── style.css           # Estilos globais
├── README.md
└── js/
    ├── app.js          # Orquestrador principal
    ├── ocr.js          # Módulo OCR (Tesseract.js)
    ├── translate.js    # Tradução com fallback
    ├── editor.js       # Canvas editor + pincel
    ├── textManager.js  # Caixas de texto draggable
    └── ui.js           # Utilitários de interface
```

---

## ⚠️ Limitações Conhecidas

- OCR para japonês requer download de ~12MB de dados (uma vez, cached pelo browser)
- A qualidade do OCR depende da resolução e nitidez da imagem
- APIs de tradução gratuitas podem ter limites de uso diário
- O Google Translate não-oficial pode parar de funcionar sem aviso
- Páginas com texto vertical japonês podem ter menor precisão de OCR

---

## 📄 Licença

MIT — use livremente.
