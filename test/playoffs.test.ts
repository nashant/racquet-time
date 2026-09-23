import { describe, expect, it } from 'vitest';
import {
  assignCourts,
  createPlayoff,
  isComplete,
  playoffOrder,
  readyMatches,
  redraw,
  setPlayoffScore,
  sides,
  startPlayoff,
} from '../src/domain/playoffs';
import type { Id, Playoff, Settings } from '../src/domain/types';
import { makeCourts } from './helpers';

function members(n: number): Id[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

function make(n: number, threePlayer: Settings['threePlayerPlayoff'] = 'roundRobin', seed = 1): Playoff {
  return startPlayoff(
    createPlayoff({
      id: 'po',
      members: members(n),
      startPosition: 1,
      format: { kind: 'points', target: 4, alternatingServe: true },
      threePlayer,
      seed,
      createdAt: 0,
    }),
  );
}

/** Plays every ready match until done; `beats(a, b)` decides each match. */
function playOut(p: Playoff, beats: (a: Id, b: Id) => boolean, diff = () => 4): { p: Playoff; played: number } {
  let played = 0;
  for (let guard = 0; guard < 100 && !isComplete(p); guard++) {
    const ready = readyMatches(p);
    expect(ready.length).toBeGreaterThan(0);
    const { owner, match } = ready[0];
    const [a, b] = sides(owner, match) as [Id, Id];
    const loserPts = Math.max(0, 4 - diff());
    p = setPlayoffScore(p, match.id, beats(a, b) ? { a: 4, b: loserPts } : { a: loserPts, b: 4 });
    played++;
  }
  return { p, played };
}

const byNumber = (a: Id, b: Id) => Number(a.slice(1)) < Number(b.slice(1));

describe('playoff brackets', () => {
  it.each([
    [2, 1],
    [4, 4],
    [5, 5],
    [8, 12],
  ])('%i players produce a full distinct ordering in %i matches', (n, expectedMatches) => {
    const { p, played } = playOut(make(n), byNumber);
    const order = playoffOrder(p)!;
    // A knockout guarantees the strongest wins; others place by where the draw put them.
    expect(order[0]).toBe('p1');
    expect([...order].sort()).toEqual(members(n));
    expect(played).toBe(expectedMatches);
    expect(p.status).toBe('done');
  });

  it.each([2, 3, 4, 5, 6, 7, 8])('%i players: every draw and result pattern yields a distinct ordering', (n) => {
    for (let seed = 1; seed < 20; seed++) {
      const strength = new Map(members(n).map((id, i) => [id, (i * 7919 + seed * 104729) % 97]));
      for (const kind of ['roundRobin', 'knockout'] as const) {
        const { p } = playOut(make(n, kind, seed), (a, b) => strength.get(a)! > strength.get(b)!);
        const order = playoffOrder(p)!;
        expect(new Set(order).size).toBe(n);
        expect([...order].sort()).toEqual(members(n));
      }
    }
  });

  it('3-player round robin orders by wins', () => {
    const { p, played } = playOut(make(3), byNumber);
    expect(played).toBe(3);
    expect(playoffOrder(p)).toEqual(['p1', 'p2', 'p3']);
  });

  it('3-player round robin cycle is broken by points difference, then deciding rallies', () => {
    // p1 > p2, p2 > p3, p3 > p1: a cycle.
    const cycle = (a: Id, b: Id) => (a === 'p1' && b === 'p2') || (a === 'p2' && b === 'p3') || (a === 'p3' && b === 'p1')
      ? true
      : (b === 'p1' && a === 'p2') || (b === 'p2' && a === 'p3') || (b === 'p3' && a === 'p1')
        ? false
        : byNumber(a, b);
    let p = make(3);
    // All matches 4-2: equal points difference, so a decider is needed.
    for (const { owner, match } of readyMatches(p)) {
      const [a, b] = sides(owner, match) as [Id, Id];
      p = setPlayoffScore(p, match.id, cycle(a, b) ? { a: 4, b: 2 } : { a: 2, b: 4 });
    }
    expect(isComplete(p)).toBe(false);
    expect(p.deciders).toHaveLength(1);
    expect(p.deciders[0].format).toEqual({ kind: 'rally' });
    const { p: done } = playOut(p, byNumber);
    expect(new Set(playoffOrder(done)!).size).toBe(3);
  });

  it('3-player knockout skips the rematch when the bye-holder wins the final', () => {
    let p = make(3, 'knockout');
    const [a, b, c] = p.draw;
    p = setPlayoffScore(p, p.matches[0].id, { a: 4, b: 1 }); // a beats b
    p = setPlayoffScore(p, p.matches[1].id, { a: 1, b: 4 }); // c beats a
    expect(isComplete(p)).toBe(true);
    expect(playoffOrder(p)).toEqual([c, a, b]);
  });

  it('3-player knockout plays the placement match when the opener winner wins the final', () => {
    let p = make(3, 'knockout');
    const [a, b, c] = p.draw;
    p = setPlayoffScore(p, p.matches[0].id, { a: 4, b: 1 }); // a beats b
    p = setPlayoffScore(p, p.matches[1].id, { a: 4, b: 1 }); // a beats c
    expect(isComplete(p)).toBe(false);
    expect(sides(p, p.matches[2])).toEqual([c, b]);
    p = setPlayoffScore(p, p.matches[2].id, { a: 1, b: 4 }); // b beats c
    expect(playoffOrder(p)).toEqual([a, b, c]);
  });

  it('respects bracket dependencies and schedules in parallel across courts', () => {
    let p = make(8, 'roundRobin');
    expect(readyMatches(p)).toHaveLength(4);
    let [scheduled] = assignCourts([p], makeCourts(['doubles', 'singles', 'singles']));
    expect(scheduled.matches.filter((m) => m.courtId).map((m) => m.courtId)).toEqual(['c1', 'c2', 'c3']);
    // Finish one quarter-final: its court frees up and the 4th quarter-final moves on.
    const first = scheduled.matches[0];
    scheduled = setPlayoffScore(scheduled, first.id, { a: 4, b: 0 });
    [scheduled] = assignCourts([scheduled], makeCourts(['doubles', 'singles', 'singles']));
    expect(scheduled.matches[3].courtId).toBe('c1');
    // Semi-finals need two finished quarter-finals.
    expect(readyMatches(scheduled).map((r) => r.match.label)).not.toContain('Semi-final 1');
  });

  it('never puts one player on two courts at once', () => {
    let p = make(3);
    [p] = assignCourts([p], makeCourts(['singles', 'singles', 'singles']));
    expect(p.matches.filter((m) => m.courtId)).toHaveLength(1);
  });

  it('resets dependent matches when an earlier result changes', () => {
    let p = make(4);
    p = setPlayoffScore(p, p.matches[0].id, { a: 4, b: 0 });
    p = setPlayoffScore(p, p.matches[1].id, { a: 4, b: 0 });
    const final = p.matches.find((m) => m.label === 'Final')!;
    p = setPlayoffScore(p, final.id, { a: 4, b: 2 });
    p = setPlayoffScore(p, p.matches[0].id, { a: 0, b: 4 });
    expect(p.matches.find((m) => m.label === 'Final')!.score).toBeNull();
  });

  it('re-draw is only allowed before starting', () => {
    const draft = createPlayoff({
      id: 'x',
      members: members(4),
      startPosition: 1,
      format: { kind: 'rally' },
      threePlayer: 'roundRobin',
      seed: 1,
      createdAt: 0,
    });
    const redrawn = redraw(draft, 12345);
    expect([...redrawn.draw].sort()).toEqual(members(4));
    expect(redraw(startPlayoff(draft), 999).draw).toEqual(draft.draw);
  });
});
