import { describe, expect, it } from 'vitest';
import { activationCredit, evaluateRound, generateRound, roundWarnings } from '../src/domain/scheduler';
import type { Player, Round } from '../src/domain/types';
import { planLayout } from '../src/domain/layout';
import { defaultSettings } from '../src/domain/types';
import { counts, makeCourts, makePlayers, onCourt, partnerCounts, playRound, simulate } from './helpers';

const settings = defaultSettings();

function credit(players: Player[], history: Round[], id: string) {
  const c = activationCredit(players, history, id);
  return { gamesCredit: c.games, sitCredit: c.sits };
}

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

  it('7 players on 1D+1S across 6 rounds: no repeat teams or singles, everyone plays singles, sit-outs within 1', () => {
    const key = (a: string, b: string) => [a, b].sort().join('|');
    for (let seed = 1; seed <= 10; seed++) {
      const players = makePlayers(7);
      const history = simulate(players, makeCourts(['doubles', 'singles']), 6, {}, seed * 100);
      const singlesMatches = history.flatMap((r) => r.matches.filter((m) => m.kind === 'singles').map((m) => key(m.sideA[0], m.sideB[0])));
      expect(new Set(singlesMatches).size).toBe(singlesMatches.length);
      for (const c of partnerCounts(history).values()) expect(c).toBe(1);
      for (let i = 0; i < history.length; i++) {
        const sits = counts(history.slice(0, i + 1), (r) => r.sittingOut);
        const s = players.map((p) => sits.get(p.id) ?? 0);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
        const singles = counts(history.slice(0, i + 1), singlesPlayers);
        const g = players.map((p) => singles.get(p.id) ?? 0);
        expect(Math.max(...g) - Math.min(...g)).toBeLessThanOrEqual(1);
        if (i > 0) {
          for (const id of history[i].sittingOut) expect(history[i - 1].sittingOut).not.toContain(id);
          for (const id of singlesPlayers(history[i])) expect(singlesPlayers(history[i - 1])).not.toContain(id);
        }
      }
      const singles = counts(history, singlesPlayers);
      for (const p of players) expect(singles.get(p.id)).toBeGreaterThanOrEqual(1);
    }
  });

  it('never lets sit-outs (over rounds present) differ by more than 1, through arrivals and withdrawals', () => {
    for (const [n, kinds] of [
      [9, ['doubles', 'singles']],
      [13, ['doubles', 'doubles', 'singles']],
      [11, ['doubles', 'doubles']],
      [5, ['singles']],
    ] as const) {
      const players = makePlayers(n);
      const courts = makeCourts([...kinds]);
      const late = players[n - 1];
      const leaver = players[0];
      late.active = false;
      const history: ReturnType<typeof simulate> = [];
      // Sit-outs counted only while present, plus the credit given on (re)activation.
      const present = () => players.filter((p) => p.active);
      const check = () => {
        const sits = counts(history, (r) => r.sittingOut);
        const s = present().map((p) => (sits.get(p.id) ?? 0) + p.sitCredit);
        expect(Math.max(...s) - Math.min(...s)).toBeLessThanOrEqual(1);
      };
      for (let r = 0; r < 12; r++) {
        if (r === 3) Object.assign(late, { active: true, ...credit(players, history, late.id), playNext: true });
        if (r === 5) leaver.active = false;
        if (r === 8) Object.assign(leaver, { active: true, ...credit(players, history, leaver.id), playNext: true });
        history.push(playRound({ players, courts, history, settings }, r + 1));
        for (const p of players) if (onCourt(history[r]).includes(p.id)) p.playNext = false;
        check();
      }
    }
  });

  it('warns when a manual swap would stretch the sit-out gap past 1', () => {
    const players = makePlayers(7);
    const courts = makeCourts(['doubles', 'singles']);
    const history = simulate(players, courts, 1);
    const req = { players, courts, history, settings };
    const next = generateRound({ ...req, seed: 9 });
    const satOut = history[0].sittingOut[0];
    // Swap last round's sitter back onto the bench: they'd be on 2 while others are on 0.
    const swapped = {
      matches: next.matches.map((m) => ({ ...m, sideA: m.sideA.map((id) => (id === satOut ? next.sittingOut[0] : id)), sideB: m.sideB.map((id) => (id === satOut ? next.sittingOut[0] : id)) })),
      sittingOut: [satOut],
    };
    expect(roundWarnings(req, next)).toEqual([]);
    expect(roundWarnings(req, swapped)).toContainEqual({ playerId: satOut, reason: 'would sit out 2 more than someone else' });
  });

  it('prioritises a late arrival and brings them in at par', () => {
    const players = makePlayers(8);
    const courts = makeCourts(['doubles', 'singles']);
    const late = players[7];
    late.active = false;
    const history = simulate(players, courts, 4);
    expect(counts(history, onCourt).get(late.id)).toBeUndefined();

    late.active = true;
    const credit = activationCredit(players, history, late.id);
    late.gamesCredit = credit.games;
    late.sitCredit = credit.sits;
    late.playNext = true;
    const games = counts(history, onCourt);
    const others = players.filter((p) => p !== late).map((p) => games.get(p.id) ?? 0);
    expect(late.gamesCredit).toBe(Math.min(...others));
    const sat = counts(history, (r) => r.sittingOut);
    expect(late.sitCredit).toBe(Math.max(...players.filter((p) => p !== late).map((p) => sat.get(p.id) ?? 0)));

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
