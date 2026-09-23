import { SCHEMA_VERSION, type Persisted, type Prefs, type Session } from '../domain/types';
import { migrate, NewerVersionError } from './migrations';
import { sessionProblem } from './validate';

export const STORAGE_KEY = 'badminton:v1';
export const RESCUE_KEY = `${STORAGE_KEY}:rescue`;
export const UNDO_LIMIT = 30;

export const DEFAULT_PREFS: Prefs = { theme: 'auto', sound: true };

export function emptyState(): Persisted {
  return { version: SCHEMA_VERSION, session: null, undo: [], prefs: { ...DEFAULT_PREFS } };
}

function readPrefs(v: unknown): Prefs {
  const p = (typeof v === 'object' && v !== null ? v : {}) as Partial<Prefs>;
  return {
    theme: p.theme === 'light' || p.theme === 'dark' ? p.theme : 'auto',
    sound: typeof p.sound === 'boolean' ? p.sound : true,
  };
}

export interface LoadResult {
  state: Persisted;
  /** Shown to the user when saved data couldn't be used (it is kept under RESCUE_KEY). */
  warning?: string;
}

function rescue(storage: Storage, raw: string): void {
  try {
    storage.setItem(`${RESCUE_KEY}:${Date.now()}`, raw);
    storage.setItem(RESCUE_KEY, raw);
  } catch {
    // Nothing more we can do; the original key is left untouched below.
  }
}

export function load(storage: Storage): LoadResult {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) return { state: emptyState() };
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fromVersion = parsed.version;
    const data = migrate(parsed);
    if (fromVersion !== data.version) storage.setItem(`${STORAGE_KEY}:pre-v${String(fromVersion)}`, raw);
    const session = (data.session ?? null) as Session | null;
    if (session !== null) {
      const problem = sessionProblem(session);
      if (problem) throw new Error(problem);
    }
    const undo = Array.isArray(data.undo) ? (data.undo as unknown[]).filter((u) => sessionProblem(u) === null) : [];
    return { state: { version: SCHEMA_VERSION, session, undo: undo as Session[], prefs: readPrefs(data.prefs) } };
  } catch (e) {
    rescue(storage, raw);
    const why = e instanceof NewerVersionError ? e.message : `Saved data couldn't be read (${(e as Error).message}).`;
    return { state: emptyState(), warning: `${why} A copy was kept safely; export it from Settings → Recovery.` };
  }
}

export type SaveResult = { ok: true; undoKept: number } | { ok: false; error: string };

/** Synchronous save. If storage is full, undo history is trimmed before giving up. */
export function save(storage: Storage, state: Persisted): SaveResult {
  let undo = state.undo.slice(-UNDO_LIMIT);
  for (;;) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, undo }));
      return { ok: true, undoKept: undo.length };
    } catch (e) {
      if (!undo.length) return { ok: false, error: (e as Error).message || 'Storage is full' };
      undo = undo.slice(Math.ceil(undo.length / 2));
    }
  }
}

export interface ExportFile {
  app: 'racquet-time';
  version: number;
  exportedAt: string;
  session: Session;
}

export function exportSession(session: Session, now = new Date()): string {
  const file: ExportFile = { app: 'racquet-time', version: SCHEMA_VERSION, exportedAt: now.toISOString(), session };
  return JSON.stringify(file, null, 2);
}

/** Parses an exported file (any past schema version). Throws with a readable message. */
export function importSession(text: string): Session {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  // Also accepts a raw saved-state blob (e.g. downloaded from Recovery).
  const isExport = typeof parsed === 'object' && parsed !== null && ((parsed as ExportFile).app === 'racquet-time' || 'undo' in parsed);
  if (!isExport) throw new Error("That file isn't a Racquet Time export.");
  const data = migrate(parsed as Record<string, unknown>);
  const problem = sessionProblem(data.session);
  if (problem) throw new Error(`The file is damaged: ${problem}.`);
  return data.session as Session;
}

export function readRescue(storage: Storage): string | null {
  return storage.getItem(RESCUE_KEY);
}
