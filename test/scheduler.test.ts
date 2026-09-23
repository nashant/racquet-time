import { describe, expect, it } from 'vitest';
import { activationCredit, evaluateRound, generateRound } from '../src/domain/scheduler';
import { planLayout } from '../src/domain/layout';
import { defaultSettings } from '../src/domain/types';
import { counts, makeCourts, makePlayers, onCourt, partnerCounts, playRound, simulate } from './helpers';

const settings = defaultSettings();

function singlesPlayers(r: { matches: { kind: string; sideA: string[]; sideB: string[] }[] }) {
  return r.matches.filter((m) => m.kind === 'singles').flatMap((m) => [...m.sideA, ...m.sideB]);
}

describe('scheduler', () => {
  it('6 players on 1D+1S across 3 rounds: all play, 1 singles each, no repeat partners', () => {
    const players = makePlayers(6);
    const history = simulate(players, makeCourts(['doubles', 'singles']), 3);
    for (const r of history) {
      expect(onCourt(r).sort()).toEqual(players.map((p) => p.id).sort());
      expect(r.sittingOut).toEqual([]);
    }
    const singles = counts(history, singlesPlayers);
    for (const p of players) expect(singles.get(p.id)).toBe(1);
    for (const c of partnerCounts(history).values()) expect(c).toBe(1);
  });

  it('7 players on 1D+1S across 7 rounds: equal sit-outs, none twice in a row', () => {
    const players = makePlayers(7);
    const history = simulate(players, makeCourts(['doubles', 'singles']), 7);
    const sits = counts(history, (r) => r.sittingOut);
    for (const p of players) expect(sits.get(p.id)).toBe(1);
    for (let i = 1; i < history.length; i++) {
      for (const id of history[i].sittingOut) expect(history[i - 1].sittingOut).not.toContain(id);
    }
  });

  it('13 players on 2D+1S: fair games, singles share and partner variety', () => {
    const players = makePlayers(13);
    const history = simulate(players, makeCourts(['doubles', 'doubles', 'singles']), 13);
    for (let i = 0; i < history.length; i++) {
      expect(history[i].sittingOut).toHaveLength(3);
      const games = counts(history.slice(0, i + 1), onCourt);
      const g = players.map((p) => games.get(p.id) ?? 0);
      expect(Math.max(...g) - Math.min(...g)).toBeLessThanOrEqual(1);
      if (i > 0) for (const id of history[i].sittingOut) expect(history[i - 1].sittingOut).not.toContain(id);
    }
    const sits = counts(history, (r) => r.sittingOut);
    for (const p of players) expect(sits.get(p.id)).toBe(3);
    const singles = counts(history, singlesPlayers);
    const s = players.map((p) => singles.get(p.id) ?? 0);
    expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
    // 52 partnerships over 78 possible pairs: repeats should be rare.
    expect(Math.max(...partnerCounts(history).values())).toBeLessThanOrEqual(2);
    // Nobody plays singles in consecutive rounds.
    for (let i = 1; i < history.length; i++) {
      for (const id of singlesPlayers(history[i])) expect(singlesPlayers(history[i - 1])).not.toContain(id);
    }
  });

  it('prioritises a late arrival and brings them in at par', () => {
    const players = makePlayers(8);
    const courts = makeCourts(['doubles', 'singles']);
    const late = players[7];
    late.active = false;
    const history = simulate(players, courts, 4);
    expect(counts(history, onCourt).get(late.id)).toBeUndefined();

    late.active = true;
    late.gamesCredit = activationCredit(players, history, late.id);
    late.playNext = true;
    const games = counts(history, onCourt);
    const others = players.filter((p) => p !== late).map((p) => games.get(p.id) ?? 0);
    expect(late.gamesCredit).toBe(Math.min(...others));

    const next = playRound({ players, courts, history, settings }, 99);
    expect(onCourt(next)).toContain(late.id);
    history.push(next);
    late.playNext = false;
    for (let r = 0; r < 8; r++) history.push(playRound({ players, courts, history, settings }, 200 + r));
    const all = counts(history, onCourt);
    const eff = players.map((p) => (all.get(p.id) ?? 0) + p.gamesCredit);
    expect(Math.max(...eff) - Math.min(...eff)).toBeLessThanOrEqual(1);
  });

  it('handles fewer players than court capacity', () => {
    const courts = makeCourts(['doubles', 'doubles']);
    const six = generateRound({ players: makePlayers(6), courts, history: [], settings, seed: 1 });
    expect(six.matches.map((m) => m.kind).sort()).toEqual(['doubles', 'singles']);
    expect(six.sittingOut).toHaveLength(0);

    const leave = generateRound({
      players: makePlayers(6),
      courts,
      history: [],
      settings: { ...settings, shortDoubles: 'leaveEmpty' },
      seed: 1,
    });
    expect(leave.matches).toHaveLength(1);
    expect(leave.sittingOut).toHaveLength(2);

    const three = generateRound({ players: makePlayers(3), courts: makeCourts(['doubles']), history: [], settings, seed: 1 });
    expect(three.matches).toHaveLength(1);
    expect(three.matches[0].kind).toBe('singles');
    expect(three.sittingOut).toHaveLength(1);

    const one = generateRound({ players: makePlayers(1), courts, history: [], settings, seed: 1 });
    expect(one.matches).toHaveLength(0);
    expect(one.sittingOut).toEqual(['p1']);
  });

  it('respects fill order when there are not enough players', () => {
    const courts = makeCourts(['singles', 'doubles']);
    expect(planLayout(4, courts, 'doublesFirst', 'asSingles').map((c) => c.kind)).toEqual(['doubles']);
    expect(planLayout(4, courts, 'singlesFirst', 'asSingles').map((c) => c.kind)).toEqual(['singles', 'singles']);
  });

  it('rotates fairly on a single singles court with an odd number of players', () => {
    const players = makePlayers(5);
    const history = simulate(players, makeCourts(['singles']), 5);
    const games = counts(history, onCourt);
    for (const p of players) expect(games.get(p.id)).toBe(2);
  });

  it('skips inactive players', () => {
    const players = makePlayers(6);
    players[0].active = false;
    const p = generateRound({ players, courts: makeCourts(['doubles', 'singles']), history: [], settings, seed: 3 });
    expect([...p.matches.flatMap((m) => [...m.sideA, ...m.sideB]), ...p.sittingOut]).not.toContain('p1');
  });

  it('is deterministic for a given seed', () => {
    const req = { players: makePlayers(12), courts: makeCourts(['doubles', 'doubles', 'singles']), history: [], settings };
    expect(generateRound({ ...req, seed: 42 })).toEqual(generateRound({ ...req, seed: 42 }));
  });

  it('evaluates a manually edited round with the same cost function', () => {
    const req = { players: makePlayers(6), courts: makeCourts(['doubles', 'singles']), history: [], settings };
    const p = generateRound({ ...req, seed: 5 });
    expect(evaluateRound(req, p).cost).toBeCloseTo(p.cost);
  });

  it('returns within 200ms for 30 players on 8 courts', () => {
    const players = makePlayers(30);
    const courts = makeCourts(['doubles', 'doubles', 'doubles', 'doubles', 'singles', 'singles', 'singles', 'singles']);
    const history = simulate(players, courts, 10);
    const t0 = performance.now();
    generateRound({ players, courts, history, settings, seed: 7 });
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
