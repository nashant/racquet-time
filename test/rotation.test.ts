import { describe, expect, it } from 'vitest';
import * as A from '../src/domain/actions';
import type { Id, Round, Session } from '../src/domain/types';

const SEVEN = ['Ann', 'Ben', 'Cat', 'Dev', 'Eve', 'Fin', 'Gus'];

function session(names = SEVEN): Session {
  // newSession starts with Court 1 doubles + Court 2 singles.
  return A.addPlayers(A.newSession('t', '2026-09-23'), names);
}

function play(s: Session, seed: number, opts?: { rotation?: boolean }): Session {
  s = A.generatePreview(s, seed, opts);
  s = A.startRound(s);
  const live = A.liveRound(s)!;
  for (const m of live.matches) s = A.setMatchScore(s, live.id, m.id, { a: 21, b: 15 });
  return A.endRound(s, 0);
}

const done = (s: Session) => s.rounds.filter((r) => r.status === 'done');
const key = (a: Id, b: Id) => [a, b].sort().join('|');
const singlesOf = (r: Round) => r.matches.filter((m) => m.kind === 'singles').flatMap((m) => [...m.sideA, ...m.sideB]);

describe('fixed rotation (7 players, 1 doubles + 1 singles)', () => {
  it('moves everyone one place along each round and meets every fairness rule for 7 rounds', () => {
    let s = session();
    for (let r = 0; r < 7; r++) s = play(s, 100 + r);
    const rounds = done(s);
    rounds.forEach((r, i) => expect(r.rotation).toEqual({ order: rounds[0].rotation!.order, step: i }));

    const teams = rounds.flatMap((r) => r.matches.filter((m) => m.kind === 'doubles').flatMap((m) => [key(m.sideA[0], m.sideA[1]), key(m.sideB[0], m.sideB[1])]));
    expect(new Set(teams).size).toBe(teams.length);
    const singlesMatches = rounds.flatMap((r) => r.matches.filter((m) => m.kind === 'singles').map((m) => key(m.sideA[0], m.sideB[0])));
    expect(new Set(singlesMatches).size).toBe(singlesMatches.length);

    const ids = s.players.map((p) => p.id);
    const sits = new Map(ids.map((id) => [id, 0]));
    const singles = new Map(ids.map((id) => [id, 0]));
    rounds.forEach((r, i) => {
      for (const id of r.sittingOut) sits.set(id, sits.get(id)! + 1);
      for (const id of singlesOf(r)) singles.set(id, singles.get(id)! + 1);
      expect(Math.max(...sits.values()) - Math.min(...sits.values())).toBeLessThanOrEqual(1);
      expect(Math.max(...singles.values()) - Math.min(...singles.values())).toBeLessThanOrEqual(1);
      if (i > 0) {
        for (const id of r.sittingOut) expect(rounds[i - 1].sittingOut).not.toContain(id);
        for (const id of singlesOf(r)) expect(singlesOf(rounds[i - 1])).not.toContain(id);
      }
    });
    // A full 7-round cycle: everyone sits out exactly once.
    for (const id of ids) expect(sits.get(id)).toBe(1);
  });

  it('hands over to the scheduler at round 8, still keeping sit-outs within 1', () => {
    let s = session();
    for (let r = 0; r < 9; r++) s = play(s, 200 + r);
    const rounds = done(s);
    expect(rounds[7].rotation ?? null).toBeNull();
    expect(rounds[8].rotation ?? null).toBeNull();
    const sits = new Map(s.players.map((p) => [p.id, 0]));
    for (const r of rounds) for (const id of r.sittingOut) sits.set(id, sits.get(id)! + 1);
    expect(Math.max(...sits.values()) - Math.min(...sits.values())).toBeLessThanOrEqual(1);
  });

  it('works whichever order the two courts are listed in', () => {
    let s = session();
    const [d, sg] = s.courts;
    s = { ...s, courts: [sg, d] };
    s = play(s, 1);
    expect(done(s)[0].rotation?.step).toBe(0);
    expect(done(s)[0].matches.map((m) => m.kind)).toEqual(['singles', 'doubles']);
  });

  it('a manual swap ends the rotation for the rest of the session', () => {
    let s = session();
    s = play(s, 1);
    s = A.generatePreview(s, 2);
    expect(A.preview(s)!.rotation?.step).toBe(1);
    const p = A.preview(s)!;
    s = A.swapPlayers(s, p.sittingOut[0], p.matches[0].sideA[0]);
    expect(A.preview(s)!.rotation).toBeNull();
    s = A.startRound(s);
    s = A.endRound(s, 0);
    s = play(s, 3);
    expect(done(s)[2].rotation ?? null).toBeNull();
  });

  it('a roster change ends the rotation, even if the player comes back', () => {
    let s = session();
    s = play(s, 1);
    s = play(s, 2);
    const leaver = s.players[0].id;
    s = A.setActive(s, leaver, false);
    s = play(s, 3);
    s = A.setActive(s, leaver, true);
    s = play(s, 4);
    expect(done(s).map((r) => r.rotation?.step ?? null)).toEqual([0, 1, null, null]);
  });

  it('is not used for other group sizes', () => {
    const s = play(session([...SEVEN, 'Hal']), 1);
    expect(done(s)[0].rotation ?? null).toBeNull();
  });

  it('regenerating round 1 re-draws the order; later, planning without it ends the rotation', () => {
    const a = A.generatePreview(session(), 1);
    const b = A.generatePreview(a, 2);
    expect(A.preview(b)!.rotation!.step).toBe(0);
    expect(A.preview(b)!.rotation!.order).not.toEqual(A.preview(a)!.rotation!.order);

    let s = play(session(), 1);
    s = A.generatePreview(s, 2, { rotation: false });
    expect(A.preview(s)!.rotation ?? null).toBeNull();
    // A roster tweak refreshes the preview but doesn't sneak the rotation back in.
    s = A.addPlayers(s, ['Hal']);
    s = A.setActive(s, s.players.find((p) => p.name === 'Hal')!.id, false);
    expect(A.preview(s)!.rotation ?? null).toBeNull();
  });
});
