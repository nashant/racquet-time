import type { Persisted, Prefs, Session } from '../domain/types';
import { emptyState, load, save, UNDO_LIMIT, type SaveResult } from './persistence';

type Listener = () => void;

export interface Store {
  get(): Persisted;
  /** Applies a pure change, saves synchronously, and (by default) records an undo step. */
  commit(fn: (s: Session) => Session, opts?: { undoable?: boolean }): void;
  /** Replaces the whole session (new session / import); undoable. */
  replace(session: Session | null): void;
  undo(): void;
  canUndo(): boolean;
  setPrefs(patch: Partial<Prefs>): void;
  subscribe(fn: Listener): () => void;
  lastSave(): SaveResult;
  loadWarning?: string;
}

export function createStore(storage: Storage): Store {
  const loaded = load(storage);
  let state: Persisted = loaded.state;
  let saveResult: SaveResult = { ok: true, undoKept: state.undo.length };
  const listeners = new Set<Listener>();

  const set = (next: Persisted) => {
    state = next;
    saveResult = save(storage, state);
    if (saveResult.ok && saveResult.undoKept < state.undo.length)
      state = { ...state, undo: saveResult.undoKept ? state.undo.slice(-saveResult.undoKept) : [] };
    listeners.forEach((l) => l());
  };

  return {
    get: () => state,
    commit(fn, opts = {}) {
      if (!state.session) return;
      const next = fn(state.session);
      if (next === state.session) return;
      const undo = opts.undoable === false ? state.undo : [...state.undo, state.session].slice(-UNDO_LIMIT);
      set({ ...state, session: next, undo });
    },
    replace(session) {
      const undo = state.session ? [...state.undo, state.session].slice(-UNDO_LIMIT) : state.undo;
      set({ ...state, session, undo });
    },
    undo() {
      const prev = state.undo[state.undo.length - 1];
      if (!prev) return;
      set({ ...state, session: prev, undo: state.undo.slice(0, -1) });
    },
    canUndo: () => state.undo.length > 0,
    setPrefs(patch) {
      set({ ...state, prefs: { ...state.prefs, ...patch } });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    lastSave: () => saveResult,
    loadWarning: loaded.warning,
  };
}

/** In-memory Storage for tests and for browsers that block localStorage. */
export class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  quota = Infinity;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    const size = [...this.data].reduce((n, [key, val]) => n + (key === k ? 0 : key.length + val.length), 0) + k.length + v.length;
    if (size > this.quota) throw new DOMException('Quota exceeded', 'QuotaExceededError');
    this.data.set(k, String(v));
  }
}

export { emptyState };
