import { describe, expect, it } from 'vitest';
import * as A from '../src/domain/actions';
import { computeStandings, unresolvedTies } from '../src/domain/ranking';
import type { Session } from '../src/domain/types';
import { migrate, migrations } from '../src/state/migrations';
import { exportSession, importSession, load, RESCUE_KEY, save, STORAGE_KEY } from '../src/state/persistence';
import { createStore, MemoryStorage } from '../src/state/store';

/** Finished rounds, a live round with a running timer, one finished and one in-progress playoff. */
function fullSession(): Session {
  let s = A.newSession('Tuesday club', '2026-09-23');
  s = A.addPlayers(s, ['Ann', 'Ben', 'Cat', 'Dev', 'Eve', 'Fin']);
  for (let r = 0; r < 2; r++) {
    s = A.generatePreview(s, r + 1);
    s = A.startRound(s);
    const live = A.liveRound(s)!;
    // Same score everywhere so ties are guaranteed.
    for (const m of live.matches) s = A.setMatchScore(s, live.id, m.id, { a: 21, b: 15 });
    s = A.endRound(s, 1_000);
  }
  const ties = unresolvedTies(computeStandings(s.players, s.rounds, s.settings.tiebreakers, s.playoffs));
  expect(ties.length).toBeGreaterThan(0);
  s = A.createPlayoffs(s, ties, 5_000, 42);
  s = A.startPlayoffs(s, s.playoffs.map((p) => p.id));
  const first = s.playoffs[0];
  s = A.setPlayoffMatchScore(s, first.id, first.matches[0].id, { a: 4, b: 2 });
  s = A.generatePreview(s, 9);
  s = A.startRound(s);
  s = A.startTimer(s, 10_000);
  return s;
}

describe('localStorage persistence', () => {
  it('round-trips a full session including a running timer and an in-progress playoff', () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    const session = fullSession();
    store.replace(session);
    store.commit((s) => A.renameSession(s, 'Tuesday club (renamed)', s.date));

    const reloaded = createStore(storage);
    expect(reloaded.loadWarning).toBeUndefined();
    const s = reloaded.get().session!;
    expect(s).toEqual(store.get().session);
    expect(A.liveRound(s)!.timer!.runningSince).toBe(10_000);
    expect(A.remainingMs(A.liveRound(s)!, 70_000)).toBe(12 * 60_000 - 60_000);
    expect(s.playoffs.map((p) => p.status).sort()).toEqual(['done', 'live']);
    expect(s.playoffs.find((p) => p.status === 'live')!.matches[0].courtId).not.toBeNull();
    expect(reloaded.canUndo()).toBe(true);
  });

  it('saves synchronously on every commit', () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    store.replace(A.newSession('x', '2026-01-01'));
    store.commit((s) => A.addPlayers(s, ['Ann']));
    expect(JSON.parse(storage.getItem(STORAGE_KEY)!).session.players[0].name).toBe('Ann');
  });

  it('undo restores the previous state, including playoffs, and persists', () => {
    const storage = new MemoryStorage();
    const store = createStore(storage);
    store.replace(fullSession());
    const before = store.get().session!;
    const p = before.playoffs[0];
    store.commit((s) => A.deletePlayoff(s, p.id));
    expect(store.get().session!.playoffs).toHaveLength(before.playoffs.length - 1);
    store.undo();
    expect(store.get().session).toEqual(before);
    expect(createStore(storage).get().session).toEqual(before);
  });

  it('never overwrites unreadable data: it is rescued and a warning shown', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, '{not json');
    const store = createStore(storage);
    expect(store.loadWarning).toMatch(/couldn't be read/);
    expect(storage.getItem(RESCUE_KEY)).toBe('{not json');
  });

  it('rescues data saved by a newer app version', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, session: null, undo: [], prefs: {} }));
    expect(load(storage).warning).toMatch(/newer version/);
    expect(storage.getItem(RESCUE_KEY)).toContain('"version":99');
  });

  it('runs migrations from older versions and keeps a pre-migration copy', () => {
    migrations[0] = (d) => ({ ...d, session: null, undo: [], migratedFrom0: true });
    try {
      expect(migrate({ version: 0 })).toMatchObject({ version: 1, migratedFrom0: true });
      const storage = new MemoryStorage();
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 0 }));
      expect(load(storage).warning).toBeUndefined();
      expect(storage.getItem(`${STORAGE_KEY}:pre-v0`)).toBe('{"version":0}');
    } finally {
      delete migrations[0];
    }
  });

  it('trims undo history rather than failing when storage is full', () => {
    const storage = new MemoryStorage();
    const session = fullSession();
    const prefs = { theme: 'auto' as const, sound: true };
    const size = JSON.stringify({ version: 1, session, undo: [session, session], prefs }).length;
    storage.quota = size + STORAGE_KEY.length + 10;
    const result = save(storage, { version: 1, session, undo: Array(10).fill(session), prefs });
    expect(result).toEqual({ ok: true, undoKept: 2 });
  });
});

describe('JSON export / import', () => {
  it('round-trips a full session', () => {
    const s = fullSession();
    expect(importSession(exportSession(s))).toEqual(s);
  });

  it('rejects files that are not exports or are damaged', () => {
    expect(() => importSession('nope')).toThrow(/valid JSON/);
    expect(() => importSession('{"hello":1}')).toThrow(/isn't a Racquet Time export/);
    const bad = JSON.parse(exportSession(fullSession()));
    bad.session.rounds[0].matches[0].sideA = ['ghost'];
    expect(() => importSession(JSON.stringify(bad))).toThrow(/unknown player/);
    bad.session.players = 'x';
    expect(() => importSession(JSON.stringify(bad))).toThrow(/players should be a list/);
  });
});
