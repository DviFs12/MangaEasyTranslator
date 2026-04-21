/**
 * core/translate.js — MET10
 * MyMemory API — corrigido o formato do langPair.
 */

const MYMEMORY = 'https://api.mymemory.translated.net/get';

export async function translateText(text, targetLang = 'pt', sourceLang = 'auto') {
  if (!text?.trim()) return '';
  // MyMemory exige sempre o formato "src|tgt"; 'auto' vira detecção automática com 'en|tgt'
  const src = (sourceLang === 'auto' || !sourceLang) ? 'ja' : sourceLang;
  const url  = `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${src}|${targetLang}`)}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.responseStatus !== 200 && json.responseStatus !== '200')
    throw new Error(json.responseDetails || 'Translation failed');
  return json.responseData?.translatedText ?? text;
}

export async function translateBatch(texts, targetLang = 'pt', sourceLang = 'auto', opts = {}) {
  const { onProgress } = opts;
  const CONCURRENCY = 3;
  const results = new Array(texts.length).fill('');
  let done = 0;
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const slice = texts.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map(t => translateText(t, targetLang, sourceLang))
    );
    settled.forEach((r, j) => {
      results[i + j] = r.status === 'fulfilled' ? r.value : texts[i + j];
      done++;
      onProgress?.(done, texts.length);
    });
  }
  return results;
}
