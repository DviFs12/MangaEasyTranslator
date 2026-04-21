/**
 * state/store.js — MET10
 *
 * Centralized state store with action-based mutations.
 * All state changes go through dispatch(action).
 * Undo/redo is supported for canvas and block operations.
 *
 * State shape:
 * {
 *   image: HTMLImageElement | null,
 *   blocks: Block[],
 *   selection: Selection | null,
 *   activeBlockId: string | null,
 *   tool: string,
 *   zoom: number,
 *   pan: { x, y },
 *   project: { name, modified },
 *   ocrLang: string,
 *   transLang: string,
 *   i18n: string,
 * }
 *
 * Block shape:
 * {
 *   id: string,
 *   text: string,
 *   translation: string,
 *   bbox: { x, y, w, h },
 *   confidence: number,
 *   visible: boolean,
 *   applied: boolean,
 *   fontSize: number,
 *   fontFamily: string,
 *   color: string,
 *   bgColor: string,
 *   bgOpacity: number,
 *   align: 'left'|'center'|'right',
 *   rotation: number,
 *   snapshotData: string | null,  // base64 PNG of original region (for undo apply)
 * }
 *
 * Selection shape:
 * {
 *   type: 'rect' | 'lasso' | 'stroke',
 *   rect: { x, y, w, h },
 *   points: [{x,y}] | null,
 *   angle: number,
 * }
 */

const MAX_UNDO = 50;

export class Store {
  constructor() {
    this._state = _initialState();
    this._listeners = new Set();
    this._undoStack = [];   // array of state snapshots (blocks only for perf)
    this._redoStack = [];
    this._canvasUndoStack = []; // ImageData snapshots
    this._canvasRedoStack = [];
  }

  // ── Public API ──────────────────────────────────────────────────────────

  getState() { return this._state; }

  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /**
   * Dispatch an action. All mutations go through here.
   * @param {{ type: string, payload?: any }} action
   */
  dispatch(action) {
    const prev = this._state;
    const next = _reduce(prev, action);
    if (next !== prev) {
      // Push undo snapshot for block-mutating actions
      if (_isUndoable(action.type)) {
        this._undoStack.push(_blockSnapshot(prev));
        if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
        this._redoStack = [];
      }
      this._state = next;
      this._notify(action);
    }
  }

  // Canvas undo/redo (separate from block state)
  pushCanvasSnapshot(imageData) {
    this._canvasUndoStack.push(imageData);
    if (this._canvasUndoStack.length > MAX_UNDO) this._canvasUndoStack.shift();
    this._canvasRedoStack = [];
  }

  popCanvasUndo() {
    if (!this._canvasUndoStack.length) return null;
    const snap = this._canvasUndoStack.pop();
    this._canvasRedoStack.push(snap);
    return snap;
  }

  popCanvasRedo() {
    if (!this._canvasRedoStack.length) return null;
    const snap = this._canvasRedoStack.pop();
    this._canvasUndoStack.push(snap);
    return snap;
  }

  canUndoCanvas() { return this._canvasUndoStack.length > 0; }
  canRedoCanvas() { return this._canvasRedoStack.length > 0; }

  undoBlock() {
    if (!this._undoStack.length) return false;
    this._redoStack.push(_blockSnapshot(this._state));
    const snap = this._undoStack.pop();
    this._state = { ...this._state, blocks: snap.blocks, activeBlockId: null };
    this._notify({ type: 'UNDO' });
    return true;
  }

  redoBlock() {
    if (!this._redoStack.length) return false;
    this._undoStack.push(_blockSnapshot(this._state));
    const snap = this._redoStack.pop();
    this._state = { ...this._state, blocks: snap.blocks, activeBlockId: null };
    this._notify({ type: 'REDO' });
    return true;
  }

  canUndoBlock() { return this._undoStack.length > 0; }
  canRedoBlock() { return this._redoStack.length > 0; }

  // ── Notify ──────────────────────────────────────────────────────────────

  _notify(action) {
    for (const fn of this._listeners) fn(this._state, action);
  }
}

// ── Reducer ────────────────────────────────────────────────────────────────

function _reduce(state, { type, payload }) {
  switch (type) {

    // ── Image ──
    case 'LOAD_IMAGE':
      return { ..._initialState(), image: payload.image, project: { name: payload.name || 'untitled', modified: false } };

    case 'RESET':
      return _initialState();

    // ── Blocks ──
    case 'ADD_BLOCK':
      return { ...state, blocks: [...state.blocks, _defaultBlock(payload)], activeBlockId: payload.id };

    case 'ADD_BLOCKS':
      return { ...state, blocks: [...state.blocks, ...payload.map(_defaultBlock)] };

    case 'UPDATE_BLOCK': {
      const blocks = state.blocks.map(b => b.id === payload.id ? { ...b, ...payload } : b);
      return { ...state, blocks };
    }

    case 'REMOVE_BLOCK': {
      const blocks = state.blocks.filter(b => b.id !== payload.id);
      const activeBlockId = state.activeBlockId === payload.id ? null : state.activeBlockId;
      return { ...state, blocks, activeBlockId };
    }

    case 'REMOVE_ALL_BLOCKS':
      return { ...state, blocks: [], activeBlockId: null };

    case 'MARK_APPLIED': {
      const blocks = state.blocks.map(b => b.id === payload.id ? { ...b, applied: true, snapshotData: payload.snapshotData } : b);
      return { ...state, blocks };
    }

    case 'SET_TRANSLATION': {
      const blocks = state.blocks.map(b => b.id === payload.id ? { ...b, translation: payload.translation } : b);
      return { ...state, blocks };
    }

    case 'SET_ALL_TRANSLATIONS': {
      const map = new Map(payload.map(p => [p.id, p.translation]));
      const blocks = state.blocks.map(b => map.has(b.id) ? { ...b, translation: map.get(b.id) } : b);
      return { ...state, blocks };
    }

    // ── Selection ──
    case 'SET_SELECTION':
      return { ...state, selection: payload };

    case 'CLEAR_SELECTION':
      return { ...state, selection: null };

    // ── Active block ──
    case 'SELECT_BLOCK':
      return { ...state, activeBlockId: payload.id };

    case 'DESELECT_BLOCK':
      return { ...state, activeBlockId: null };

    // ── Tool ──
    case 'SET_TOOL':
      return { ...state, tool: payload.tool };

    // ── Zoom / Pan ──
    case 'SET_ZOOM':
      return { ...state, zoom: payload.zoom };

    case 'SET_PAN':
      return { ...state, pan: payload };

    // ── Settings ──
    case 'SET_OCR_LANG':
      return { ...state, ocrLang: payload.lang };

    case 'SET_TRANS_LANG':
      return { ...state, transLang: payload.lang };

    case 'SET_I18N':
      return { ...state, i18n: payload.lang };

    // ── Project ──
    case 'MARK_MODIFIED':
      return { ...state, project: { ...state.project, modified: true } };

    case 'MARK_SAVED':
      return { ...state, project: { ...state.project, modified: false } };

    case 'LOAD_PROJECT':
      return { ...state, ...payload, project: { name: payload.name || 'project', modified: false } };

    default:
      return state;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _initialState() {
  return {
    image: null,
    blocks: [],
    selection: null,
    activeBlockId: null,
    tool: 'select',
    zoom: 1,
    pan: { x: 0, y: 0 },
    project: { name: 'untitled', modified: false },
    ocrLang: 'jpn',
    transLang: 'pt',
    i18n: navigator.language?.startsWith('pt') ? 'pt' : 'en',
  };
}

function _defaultBlock(opts) {
  return {
    id: opts.id ?? `block-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text: opts.text ?? '',
    translation: opts.translation ?? '',
    bbox: opts.bbox ?? { x: 50, y: 50, w: 160, h: 80 },
    confidence: opts.confidence ?? 0,
    visible: opts.visible ?? true,
    applied: opts.applied ?? false,
    fontSize: opts.fontSize ?? 18,
    fontFamily: opts.fontFamily ?? 'Bangers',
    color: opts.color ?? '#000000',
    bgColor: opts.bgColor ?? '#ffffff',
    bgOpacity: opts.bgOpacity ?? 0.9,
    align: opts.align ?? 'center',
    rotation: opts.rotation ?? 0,
    snapshotData: opts.snapshotData ?? null,
  };
}

function _blockSnapshot(state) {
  return { blocks: state.blocks.map(b => ({ ...b })) };
}

const UNDOABLE_ACTIONS = new Set([
  'ADD_BLOCK', 'ADD_BLOCKS', 'UPDATE_BLOCK', 'REMOVE_BLOCK',
  'REMOVE_ALL_BLOCKS', 'MARK_APPLIED', 'SET_TRANSLATION', 'SET_ALL_TRANSLATIONS',
]);

function _isUndoable(type) { return UNDOABLE_ACTIONS.has(type); }
