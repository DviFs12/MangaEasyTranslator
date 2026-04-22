/**
 * core/translate.js — MET10
 * MyMemory API — mapeamento correto de códigos Tesseract → ISO 639-1
 */

const MYMEMORY = 'https://api.mymemory.translated.net/get';

// Tesseract usa códigos de 3 letras; MyMemory usa ISO 639-1 (2 letras)
const LANG_MAP = {
  jpn: 'ja', chi_sim: 'zh', chi_tra: 'zh', kor: 'ko',
  por: 'pt', eng: 'en', spa: 'es', fra: 'fr', deu: 'de',
  ita: 'it', rus: 'ru', ind: 'id', vie: 'vi', ara: 'ar', tha: 'th',
};

function toISO(code) {
  return LANG_MAP[code] || code.slice(0, 2);
}

export async function translateText(text, targetLang = 'pt', sourceLang = 'ja') {
  if (!text?.trim()) return '';
  const src = toISO(sourceLang);
  const tgt = toISO(targetLang);
  const url = `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(`${src}|${tgt}`)}`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.responseStatus !== 200 && json.responseStatus !== '200')
    throw new Error(json.responseDetails || 'Translation failed');
  return json.responseData?.translatedText ?? text;
}

export async function translateBatch(texts, targetLang = 'pt', sourceLang = 'ja', opts = {}) {
  const { onProgress } = opts;
  const CONCURRENCY = 3;
  const results = new Array(texts.length).fill('');
  let done = 0;
  for (let i = 0; i < texts.length; i += CONCURRENCY) {
    const slice   = texts.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map(txt => translateText(txt, targetLang, sourceLang))
    );
    settled.forEach((r, j) => {
      results[i + j] = r.status === 'fulfilled' ? r.value : texts[i + j];
      done++;
      onProgress?.(done, texts.length);
    });
  }
  return results;
}
