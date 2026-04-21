/**
 * state/project.js — MET10
 * Project save/load/autosave. Pure data logic, no UI.
 */

const AUTOSAVE_KEY = 'met10_autosave';
const AUTOSAVE_INTERVAL = 30_000;

let _autosaveTimer = null;

// ── Save ──────────────────────────────────────────────────────────────────

export function buildProjectData(state, canvas) {
  return {
    version: 10,
    name: state.project.name,
    imageData: canvas.toDataURL('image/png'),
    blocks: state.blocks,
    ocrLang: state.ocrLang,
    transLang: state.transLang,
    savedAt: new Date().toISOString(),
  };
}

export function saveProjectFile(data) {
  const json = JSON.stringify(data);
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${data.name || 'project'}.met10`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Load ──────────────────────────────────────────────────────────────────

export async function loadProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      try { resolve(JSON.parse(e.target.result)); }
      catch (err) { reject(new Error('Invalid project file')); }
    };
    reader.onerror = () => reject(new Error('Read error'));
    reader.readAsText(file);
  });
}

export async function restoreProjectData(data) {
  if (!data?.imageData) throw new Error('Missing image data');
  const img = await _loadImage(data.imageData);
  return { img, blocks: data.blocks || [], ocrLang: data.ocrLang || 'jpn', transLang: data.transLang || 'pt', name: data.name || 'project' };
}

// ── Autosave ──────────────────────────────────────────────────────────────

export function startAutosave(getDataFn) {
  stopAutosave();
  _autosaveTimer = setInterval(() => {
    try {
      const data = getDataFn();
      if (data) localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(data));
    } catch (_) {}
  }, AUTOSAVE_INTERVAL);
}

export function stopAutosave() {
  if (_autosaveTimer) { clearInterval(_autosaveTimer); _autosaveTimer = null; }
}

export async function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

export function clearAutosave() {
  localStorage.removeItem(AUTOSAVE_KEY);
}

// ── Export PNG ────────────────────────────────────────────────────────────

export function exportPNG(baseCanvas, textCanvas, name = 'export') {
  const out = document.createElement('canvas');
  out.width = baseCanvas.width; out.height = baseCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  if (textCanvas) ctx.drawImage(textCanvas, 0, 0);
  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = `${name}.png`;
  a.click();
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
