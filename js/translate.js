/**
 * translate.js — Tradução com múltiplos serviços e cache em memória.
 *
 * Ordem de tentativas:
 *  1. Google Translate endpoint público (mais rápido, sem chave)
 *  2. MyMemory (gratuito, 5k chars/dia sem chave)
 *  3. LibreTranslate instâncias públicas
 */

const cache = new Map();

function cacheKey(text, src, tgt) { return `${src}|${tgt}|${text.slice(0, 200)}`; }

// Mapa de códigos Tesseract → códigos de API
const LANG = { jpn: 'ja', eng: 'en', chi_sim: 'zh-CN', kor: 'ko' };

// ─── Google Translate (endpoint público não-oficial) ───────────
async function googleTranslate(text, src, tgt) {
  const sl = LANG[src] || src;
  const tl = tgt === 'pt' ? 'pt' : tgt;
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error(`Google ${r.status}`);
  const d = await r.json();
  if (!Array.isArray(d?.[0])) throw new Error('Google: resposta inesperada');
  return d[0].filter(Boolean).map(p => p[0]).filter(Boolean).join('');
}

// ─── MyMemory ─────────────────────────────────────────────────
async function myMemory(text, src, tgt) {
  const sl = LANG[src] || src;
  const tl = tgt === 'pt' ? 'pt-BR' : tgt;
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.slice(0, 500))}&langpair=${sl}|${tl}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`MyMemory ${r.status}`);
  const d = await r.json();
  if (String(d.responseStatus) === '429') throw new Error('MyMemory: quota excedida');
  const t = d.responseData?.translatedText;
  if (!t || t === text) throw new Error('MyMemory: sem tradução');
  return t;
}

// ─── LibreTranslate (instâncias públicas) ─────────────────────
const LIBRE = ['https://libretranslate.com/translate', 'https://trans.zillyhuhn.com/translate'];
async function libreTranslate(text, src, tgt) {
  const sl = LANG[src] || src;
  const tl = tgt === 'pt' ? 'pt' : tgt;
  for (const ep of LIBRE) {
    try {
      const r = await fetch(ep, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: text.slice(0, 500), source: sl, target: tl, format: 'text' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.translatedText) return d.translatedText;
    } catch { /* try next */ }
  }
  throw new Error('LibreTranslate: indisponível');
}

// ─── Principal com fallback ───────────────────────────────────
export async function translateText(text, srcLang = 'jpn', tgtLang = 'pt') {
  const t = text?.trim();
  if (!t) return { text: '', service: 'skip' };

  const key = cacheKey(t, srcLang, tgtLang);
  if (cache.has(key)) return { text: cache.get(key), service: 'cache' };

  const services = [
    { name: 'Google',        fn: () => googleTranslate(t, srcLang, tgtLang) },
    { name: 'MyMemory',      fn: () => myMemory(t, srcLang, tgtLang) },
    { name: 'LibreTranslate',fn: () => libreTranslate(t, srcLang, tgtLang) },
  ];

  let lastErr;
  for (const svc of services) {
    try {
      const result = await svc.fn();
      if (result?.trim()) {
        cache.set(key, result);
        return { text: result, service: svc.name };
      }
    } catch (e) {
      lastErr = e;
      console.warn(`[translate] ${svc.name}:`, e.message);
    }
  }
  throw new Error(`Todos os serviços falharam. Último: ${lastErr?.message}`);
}

// ─── Batch com concorrência limitada ─────────────────────────
export async function translateBatch(items, srcLang, tgtLang, onEach = () => {}) {
  const CONCURRENCY = 2;
  const queue = [...items];

  async function worker() {
    while (queue.length) {
      const item = queue.shift();
      try {
        const res = await translateText(item.text, srcLang, tgtLang);
        onEach(item.id, res, null);
      } catch (err) {
        onEach(item.id, null, err);
      }
      await new Promise(r => setTimeout(r, 350)); // evitar rate-limit
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}
