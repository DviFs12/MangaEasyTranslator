/**
 * core/translate.js — MET10
 * Translation via MyMemory API (free, no key needed).
 * No UI dependencies.
 */

const MYMEMORY_URL = 'https://api.mymemory.translated.net/get';

/**
 * Translate a single text string.
 * @param {string} text
 * @param {string} targetLang  e.g. 'pt', 'en', 'es'
 * @param {string} sourceLang  e.g. 'ja', 'en', 'auto'
 * @returns {Promise<string>} translated text
 */
export async function translateText(text, targetLang = 'pt', sourceLang = 'auto') {
  if (!text?.trim()) return '';
  const langPair = sourceLang === 'auto'
    ? `${targetLang}`
    : `${sourceLang}|${targetLang}`;
  const url = `${MYMEMORY_URL}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translation HTTP ${res.status}`);
  const data = await res.json();
  if (data.responseStatus !== 200) throw new Error(data.responseDetails || 'Translation error');
  return data.responseData?.translatedText ?? text;
}

/**
 * Translate multiple texts in parallel (max concurrency).
 * @param {string[]} texts
 * @param {string} targetLang
 * @param {string} sourceLang
 * @param {{ onProgress?: (done: number, total: number) => void }} opts
 * @returns {Promise<string[]>}
 */
export async function translateBatch(texts, targetLang = 'pt', sourceLang = 'auto', opts = {}) {
  const { onProgress } = opts;
  const CONCURRENCY = 3;
  const results = new Array(texts.length).fill('');
  let done = 0;

  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const slice = texts.slice(i, i + CONCURRENCY);
    const translations = await Promise.allSettled(
      slice.map(t => translateText(t, targetLang, sourceLang))
    );
    for (let j = 0; j < slice.length; j++) {
      const r = translations[j];
      results[i + j] = r.status === 'fulfilled' ? r.value : texts[i + j];
      done++;
      onProgress?.(done, texts.length);
    }
  }
  return results;
}
