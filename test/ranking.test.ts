import { describe, expect, it } from 'vitest';
import { computeStandings, ordinal, unresolvedTies } from '../src/domain/ranking';
import { createPlayoff, setPlayoffScore, startPlayoff } from '../src/domain/playoffs';
import { computeStats } from '../src/domain/stats';
import type { Match, Playoff, Round, Tiebreaker } from '../src/domain/types';
import { makePlayers } from './helpers';

let seq = 0;
function singles(a: string, b: string, sa: number, sb: number): Match {
  return { id: `m${++seq}`, courtId: 'c1', kind: 'singles', sideA: [a], sideB: [b], score: { a: sa, b: sb } };
}
function doubles(a: string[], b: string[], sa: number, sb: number): Match {
  return { id: `m${++seq}`, courtId: 'c1', kind: 'doubles', sideA: a, sideB: b, score: { a: sa, b: sb } };
}
function round(...matches: Match[]): Round {
  return { id: `r${++seq}`, status: 'done', seed: 0, matches, sittingOut: [], timer: null };
}

const players = makePlayers(4);
const DEFAULT: Tiebreaker[] = ['winPct', 'avgPointsDiff', 'pointsFor', 'headToHead'];

describe('stats', () => {
  it('computes wins, points and averages; unscored matches are excluded', () => {
    const rounds = [
      round(singles('p1', 'p2', 21, 15), doubles(['p3', 'p4'], ['p1', 'p2'], 10, 21)),
      round({ ...singles('p1', 'p3', 0, 0), score: null }),
    ];
    const s = computeStats(players, rounds);
    expect(s.get('p1')).toMatchObject({ matchesPlayed: 2, wins: 2, pointsFor: 42, pointsAgainst: 25, pointsDiff: 17, winPct: 1, singles: 1, doubles: 1, appearances: 3 });
    expect(s.get('p1')!.avgPointsDiff).toBeCloseTo(8.5);
    expect(s.get('p3')).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 1, appearances: 2 });
  });
});

describe('ranking', () => {
  it('orders by the configured tiebreakers', () => {
    const rounds = [round(singles('p1', 'p2', 21, 19), singles('p3', 'p4', 21, 5)), round(singles('p2', 'p4', 21, 10), singles('p1', 'p3', 21, 20))];
    // p1: 2 wins, avg +1.5. p2: 1 win, avg +4.5. p3: 1 win, avg +7.5. p4: 0 wins.
    const byWinPct = computeStandings(players, rounds, DEFAULT, []);
    expect(byWinPct.rows.map((r) => r.playerId)).toEqual(['p1', 'p3', 'p2', 'p4']);
    const byAvg = computeStandings(players, rounds, ['avgPointsDiff'], []);
    expect(byAvg.rows.map((r) => r.playerId)).toEqual(['p3', 'p2', 'p1', 'p4']);
    // Reordering tiebreakers re-ranks without any "calculate" step.
    const byFor = computeStandings(players, rounds, ['pointsFor', 'winPct'], []);
    expect(byFor.rows[0].playerId).toBe('p1');
  });

  it('uses head-to-head among players still level', () => {
    // p1 and p2 both 1-1 with +0 and 36 points for; p2 beat p1. p3/p4 differ on points.
    const rounds = [round(singles('p2', 'p1', 21, 15), singles('p3', 'p4', 21, 5)), round(singles('p1', 'p3', 21, 15), singles('p4', 'p2', 21, 15))];
    const st = computeStandings(players, rounds, DEFAULT, []);
    const order = st.rows.map((r) => r.playerId);
    expect(order.indexOf('p2')).toBeLessThan(order.indexOf('p1'));
  });

  it('detects every group still exactly level and labels them =Nth with a shared group', () => {
    const rounds = [round(singles('p1', 'p2', 21, 10), singles('p3', 'p4', 21, 10)), round(singles('p1', 'p4', 21, 10), singles('p3', 'p2', 21, 10))];
    // p1 and p3 identical (2-0, +22, 42 for, h2h 0); p2 and p4 identical.
    const st = computeStandings(players, rounds, DEFAULT, []);
    expect(st.ties.map((t) => [t.members, t.position])).toEqual([
      [['p1', 'p3'], 1],
      [['p2', 'p4'], 3],
    ]);
    const labels = Object.fromEntries(st.rows.map((r) => [r.playerId, [r.label, r.tieGroup]]));
    expect(labels).toEqual({ p1: ['=1st', 0], p3: ['=1st', 0], p2: ['=3rd', 1], p4: ['=3rd', 1] });
  });

  it('lists players without scored matches as unranked', () => {
    const st = computeStandings(makePlayers(3), [round(singles('p1', 'p2', 21, 10))], DEFAULT, []);
    expect(st.rows.at(-1)).toMatchObject({ playerId: 'p3', position: null, label: '—' });
    expect(st.ties).toEqual([]);
  });

  it('reports no ties before any match is scored', () => {
    expect(computeStandings(makePlayers(4), [], DEFAULT, []).ties).toEqual([]);
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
  });
});

describe('playoffs in the standings', () => {
  // p2/p3 level on everything; everyone else distinct.
  const five = makePlayers(5);
  const base = [
    round(singles('p1', 'p2', 21, 10), singles('p3', 'p4', 21, 10)),
    round(singles('p1', 'p3', 21, 10), singles('p2', 'p4', 21, 10)),
    round(singles('p1', 'p4', 21, 10), singles('p5', 'p4', 21, 5)),
  ];

  function resolved(winner: string): Playoff {
    let p = startPlayoff(
      createPlayoff({ id: 'po1', members: ['p2', 'p3'], startPosition: 3, format: { kind: 'rally' }, threePlayer: 'roundRobin', seed: 3, createdAt: 1 }),
    );
    const winnerIsA = p.draw[0] === winner;
    p = setPlayoffScore(p, p.matches[0].id, winnerIsA ? { a: 1, b: 0 } : { a: 0, b: 1 });
    return p;
  }

  it('reorders only within the tied group and leaves stats untouched', () => {
    const before = computeStandings(five, base, DEFAULT, []);
    expect(before.ties.map((t) => t.members)).toEqual([['p2', 'p3']]);
    const after = computeStandings(five, base, DEFAULT, [resolved('p3')]);
    expect(after.rows.map((r) => [r.playerId, r.label])).toEqual([
      ['p5', '1st'], // 1-0 at +16 beats p1's 3-0 at +11 on average points difference
      ['p1', '2nd'],
      ['p3', '3rd (playoff)'],
      ['p2', '4th (playoff)'],
      ['p4', '5th'],
    ]);
    expect(after.rows.map((r) => r.stats)).toEqual(
      after.rows.map((r) => before.rows.find((b) => b.playerId === r.playerId)!.stats),
    );
    expect(unresolvedTies(after)).toEqual([]);
    expect(after.stale.size).toBe(0);
  });

  it('marks a playoff stale and stops applying it when a score edit breaks the tie', () => {
    const playoff = resolved('p3');
    const edited = base.map((r, i) =>
      i === 1 ? { ...r, matches: r.matches.map((m, j) => (j === 1 ? { ...m, score: { a: 21, b: 12 } } : m)) } : r,
    );
    const st = computeStandings(five, edited, DEFAULT, [playoff]);
    expect(st.stale.has('po1')).toBe(true);
    expect(st.rows.some((r) => r.viaPlayoff)).toBe(false);
  });

  it('marks a playoff stale when a tie gains a member, and falls back to showing the tie', () => {
    const playoff = resolved('p3');
    // p5 loses a match 10-21 to make them level with p2 and p3.
    const edited = [...base.slice(0, 2), round(singles('p1', 'p4', 21, 10), singles('p5', 'p4', 21, 10)), round(singles('p4', 'p5', 21, 10))];
    const st = computeStandings(five, edited, DEFAULT, [playoff]);
    expect(st.stale.has('po1')).toBe(true);
    const tie = st.ties.find((t) => t.members.includes('p2'))!;
    expect(tie.members).toEqual(['p2', 'p3', 'p5']);
    expect(st.rows.filter((r) => r.label === '=2nd').map((r) => r.playerId).sort()).toEqual(['p2', 'p3', 'p5']);
  });

  it('shows an in-progress playoff as still tied', () => {
    const p = startPlayoff(
      createPlayoff({ id: 'po2', members: ['p2', 'p3'], startPosition: 2, format: { kind: 'rally' }, threePlayer: 'roundRobin', seed: 3, createdAt: 1 }),
    );
    const st = computeStandings(five, base, DEFAULT, [p]);
    expect(st.ties[0].inProgress).toBe('po2');
    expect(st.rows.filter((r) => r.label.startsWith('=')).length).toBe(2);
    expect(unresolvedTies(st)).toEqual([]);
  });
});
