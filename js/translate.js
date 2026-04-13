/**
 * translate.js — Módulo de tradução com múltiplos serviços e fallback automático.
 *
 * Estratégia de fallback:
 *  1. MyMemory (gratuito, sem chave, até 5000 chars/dia)
 *  2. LibreTranslate (instância pública — pode estar offline)
 *  3. Bergamot/translateLocally (WASM, offline) — futuro
 *
 * Para japonês o MyMemory funciona bem com frases curtas de mangá.
 */

// ---- CACHE em memória para economizar chamadas ----
const translationCache = new Map();

function cacheKey(text, src, tgt) {
  return `${src}:${tgt}:${text}`;
}

// ---- MyMemory API ----
// https://mymemory.translated.net/doc/spec.php
async function translateMyMemory(text, srcLang, tgtLang) {
  // MyMemory usa códigos como 'ja', 'pt-BR', 'en'
  const langMap = { jpn: 'ja', eng: 'en', chi_sim: 'zh', kor: 'ko' };
  const src = langMap[srcLang] || srcLang;
  const tgt = tgtLang === 'pt' ? 'pt-BR' : tgtLang;

  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src}|${tgt}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`MyMemory HTTP ${resp.status}`);

  const data = await resp.json();

  if (data.responseStatus === 200 || data.responseStatus === '200') {
    const translated = data.responseData?.translatedText;
    if (translated && translated !== text) return translated;
  }
  // Limite de quota
  if (String(data.responseStatus) === '429') {
    throw new Error('MyMemory: limite de quota atingido');
  }
  throw new Error(`MyMemory: ${data.responseDetails || 'resposta inválida'}`);
}

// ---- LibreTranslate (instância pública) ----
const LIBRE_ENDPOINTS = [
  'https://libretranslate.com/translate',
  'https://trans.zillyhuhn.com/translate',
];

async function translateLibre(text, srcLang, tgtLang) {
  const langMap = { jpn: 'ja', eng: 'en', chi_sim: 'zh', kor: 'ko' };
  const src = langMap[srcLang] || srcLang;
  const tgt = tgtLang === 'pt' ? 'pt' : tgtLang;

  for (const endpoint of LIBRE_ENDPOINTS) {
    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text, source: src, target: tgt, format: 'text' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      if (data.translatedText) return data.translatedText;
    } catch {
      // tenta próximo endpoint
    }
  }
  throw new Error('LibreTranslate: nenhum endpoint disponível');
}

// ---- Google Translate não-oficial (sem chave) ----
// Usa o endpoint do Google Tradutor via CORS proxy se disponível
async function translateGoogle(text, srcLang, tgtLang) {
  const langMap = { jpn: 'ja', eng: 'en', chi_sim: 'zh-CN', kor: 'ko' };
  const src = langMap[srcLang] || srcLang;
  const tgt = tgtLang === 'pt' ? 'pt' : tgtLang;

  // Endpoint público não-oficial (pode mudar)
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${src}&tl=${tgt}&dt=t&q=${encodeURIComponent(text)}`;

  const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resp.ok) throw new Error(`Google HTTP ${resp.status}`);

  const data = await resp.json();

  // A resposta é um array aninhado
  if (Array.isArray(data) && Array.isArray(data[0])) {
    const parts = data[0].filter(Boolean).map(p => p[0]).filter(Boolean);
    const result = parts.join('');
    if (result) return result;
  }
  throw new Error('Google: resposta inesperada');
}

// ---- Função principal com fallback ----
/**
 * Traduz um texto com fallback automático entre serviços.
 * @param {string} text
 * @param {string} srcLang - código Tesseract (jpn, eng, etc.)
 * @param {string} tgtLang - código destino (pt, en, es, fr)
 * @returns {Promise<{text: string, service: string}>}
 */
export async function translateText(text, srcLang = 'jpn', tgtLang = 'pt') {
  if (!text || !text.trim()) return { text: '', service: 'none' };

  const key = cacheKey(text.trim(), srcLang, tgtLang);
  if (translationCache.has(key)) {
    return { text: translationCache.get(key), service: 'cache' };
  }

  const services = [
    { name: 'Google (não-oficial)', fn: () => translateGoogle(text, srcLang, tgtLang) },
    { name: 'MyMemory', fn: () => translateMyMemory(text, srcLang, tgtLang) },
    { name: 'LibreTranslate', fn: () => translateLibre(text, srcLang, tgtLang) },
  ];

  let lastError = null;
  for (const svc of services) {
    try {
      const result = await svc.fn();
      if (result && result.trim()) {
        translationCache.set(key, result);
        return { text: result, service: svc.name };
      }
    } catch (err) {
      lastError = err;
      console.warn(`[translate] ${svc.name} falhou:`, err.message);
    }
  }

  throw new Error(`Todos os serviços falharam. Último erro: ${lastError?.message}`);
}

/**
 * Traduz múltiplos textos em paralelo (limitado para não sobrecarregar APIs).
 * @param {Array<{id, text}>} items
 * @param {string} srcLang
 * @param {string} tgtLang
 * @param {function} onEach - callback(id, result, error)
 */
export async function translateBatch(items, srcLang, tgtLang, onEach = () => {}) {
  const CONCURRENCY = 3;
  const queue = [...items];
  const results = [];

  async function processNext() {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        // Quebrar textos muito longos
        const shortText = item.text.slice(0, 500);
        const result = await translateText(shortText, srcLang, tgtLang);
        onEach(item.id, result, null);
        results.push({ id: item.id, ...result });
      } catch (err) {
        onEach(item.id, null, err);
        results.push({ id: item.id, text: '', error: err.message });
      }
      // Pequeno delay para não bater rate limit
      await sleep(300);
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, processNext);
  await Promise.all(workers);
  return results;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
