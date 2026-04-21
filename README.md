# MangaEasyTranslator v10

Editor web de scanlation para tradução de mangás, manhwas e manhuas.  
100% frontend — funciona diretamente no navegador, sem servidor ou instalação.

---

## Como usar

### 1. Abrir uma imagem

Arraste um arquivo PNG, JPG ou WEBP para a área central, ou clique nela para selecionar.

Para retomar um trabalho anterior, clique em **📂 Carregar** e selecione um arquivo `.met10`.

---

### 2. Ferramentas de seleção

Use a barra à esquerda (inspirada no Photoshop) para escolher como selecionar regiões:

| Ícone | Tecla | Descrição |
|-------|-------|-----------|
| ⬚ Selecionar | `S` | Retângulo de seleção |
| 🔴 Laço | `L` | Seleção livre por polígono |
| → Linha OCR | `K` | Desenhe uma linha sobre o texto para OCR orientado |
| 🖌 Pincel | `B` | Pintura manual sobre a imagem |
| ⬜ Borracha | `E` | Apaga pixels da imagem base |
| 🔁 Clone | `C` | Carimbo clone (Alt+clique para definir a origem) |
| ✋ Mover | `Space` ou `Alt` | Navegar pela imagem |

---

### 3. Ações sobre uma seleção

Após criar uma seleção (retângulo, laço ou linha), uma barra aparece abaixo da seleção com:

- **🔍 OCR** — detecta e extrai o texto da região selecionada
- **🧹 Limpar** — remove somente os pixels escuros (texto), preservando o fundo
- **🎨 Inpaint** — preenche a seleção reconstruindo o background
- **📝 Texto** — cria uma caixa de texto na região para digitação manual
- **✕** — cancela a seleção

---

### 4. OCR automático

Clique em **🔍 OCR** no cabeçalho para detectar todo o texto da página de uma vez.

Configure o idioma de origem no painel direito (⚙ Config) antes de executar.  
Modos de segmentação disponíveis: Auto, Bloco, Linha, Palavra.

---

### 5. Tradução

**Traduzir um bloco:** na lista de caixas (📝 Caixas), clique no botão 🌐 ao lado do bloco desejado.

**Traduzir tudo:** clique em **🌐 Traduzir** no cabeçalho para traduzir todos os blocos com texto pendente.

Configure o idioma de destino no painel ⚙ Config.

---

### 6. Gerenciar caixas de texto

Na aba **📝 Caixas** do painel direito, cada bloco detectado mostra:

- Texto original (OCR)
- Tradução (se disponível)
- Botões: **OCR** · **🌐 Traduzir** · **🧹 Limpar** · **🎨 Inpaint** · **Aplicar**

Clique em um bloco para selecioná-lo. O editor aparece na parte inferior do painel com:
- Campos editáveis para o texto OCR e a tradução
- Fonte, tamanho, cor, fundo, opacidade, rotação, alinhamento

**Arrastar:** clique e arraste a caixa no canvas para reposicioná-la.  
**Redimensionar:** use as alças azuis nos cantos/bordas da caixa selecionada.  
**Remover:** botão ✕ vermelho no canto superior da caixa ou na lista.

---

### 7. Aplicar tradução à imagem

Clique em **Aplicar** no card do bloco para renderizar a tradução diretamente no canvas base.  
A área original fica salva — o botão muda para **✓ Aplicado** e pode ser revertido pelo undo.

---

### 8. Limpar texto original

Antes de aplicar a tradução, limpe o texto original do mangá:

- **🧹 Limpar** (no card ou na toolbar de seleção): remove somente pixels escuros (ideal para texto sobre screentone)
- **🎨 Inpaint** (no card ou toolbar): reconstrói o fundo da região inteira

O limiar de detecção de pixels de texto pode ser ajustado em ⚙ Config > Limiar de texto.

---

### 9. Salvar e exportar

| Ação | Como |
|------|------|
| Salvar projeto | **💾** no cabeçalho ou `Ctrl+S` — gera arquivo `.met10` com imagem e todas as caixas |
| Carregar projeto | **📂** no cabeçalho |
| Exportar PNG | **⬇ Exportar PNG** — salva a imagem final com as traduções compostas |

O projeto é autossalvo no navegador a cada 30 segundos.

---

### 10. Atalhos de teclado

| Tecla | Ação |
|-------|------|
| `S` | Ferramenta Selecionar |
| `L` | Ferramenta Laço |
| `K` | Ferramenta Linha OCR |
| `B` | Pincel |
| `E` | Borracha |
| `C` | Clone |
| `Space` / `Alt` | Mover (pan) |
| `0` | Ajustar imagem à tela |
| `+` / `-` | Zoom in / out |
| `Ctrl+Z` | Desfazer |
| `Ctrl+Y` | Refazer |
| `Ctrl+S` | Salvar projeto |
| `Delete` | Remover caixa selecionada |
| `Esc` | Cancelar seleção |

---

### Zoom e navegação

- **Scroll do mouse** — zoom centrado no cursor
- **Alt + arrastar** ou **ferramenta Mover** — pan (mover a imagem)
- **Barra de zoom** (parte inferior) — controle deslizante de zoom
- **⊡** — ajustar à janela

---

## Idiomas da interface

Clique em **🌐 EN / PT** no cabeçalho para alternar entre português e inglês.

---

## Hospedagem (GitHub Pages)

1. Crie um repositório no GitHub
2. Faça upload de todos os arquivos desta pasta
3. Ative GitHub Pages (Settings → Pages → Deploy from branch → main)
4. Acesse pelo link gerado — nenhuma configuração adicional necessária

