import { describe, expect, it } from 'vitest';
import * as A from '../src/domain/actions';
import { computeStandings, unresolvedTies } from '../src/domain/ranking';
import type { Session } from '../src/domain/types';

function started(names: string[], rounds = 1): Session {
  let s = A.newSession('t', '2026-09-23');
  s = A.addPlayers(s, names);
  for (let r = 0; r < rounds; r++) {
    s = A.generatePreview(s, r + 1);
    s = A.startRound(s);
    const live = A.liveRound(s)!;
    for (const m of live.matches) s = A.setMatchScore(s, live.id, m.id, { a: 21, b: 15 });
    s = A.endRound(s, 0);
  }
  return s;
}

const onCourt = (s: Session) => A.preview(s)!.matches.flatMap((m) => [...m.sideA, ...m.sideB]);
const idOf = (s: Session, name: string) => s.players.find((p) => p.name === name)!.id;

describe('session actions', () => {
  it('ignores blank and duplicate names when pasting a list', () => {
    const s = A.addPlayers(A.newSession('t', 'd'), ['Ann', ' ann ', '', 'Ben', '  ']);
    expect(s.players.map((p) => p.name)).toEqual(['Ann', 'Ben']);
  });

  it('a late arrival joins at par and plays next', () => {
    let s = started(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 3);
    s = A.addPlayers(s, ['Late']);
    const late = s.players.find((p) => p.name === 'Late')!;
    expect(late.playNext).toBe(true);
    expect(late.gamesCredit).toBeGreaterThanOrEqual(2);
    s = A.generatePreview(s, 50);
    expect(onCourt(s)).toContain(late.id);
    s = A.startRound(s);
    expect(s.players.find((p) => p.id === late.id)!.playNext).toBe(false);
  });

  it('withdrawing a player mid-round keeps their score and drops them from later rounds', () => {
    let s = started(['A', 'B', 'C', 'D', 'E', 'F'], 1);
    s = A.generatePreview(s, 2);
    s = A.startRound(s);
    const live = A.liveRound(s)!;
    const m = live.matches[0];
    s = A.setMatchScore(s, live.id, m.id, { a: 11, b: 7 });
    const injured = m.sideA[0];
    s = A.setActive(s, injured, false);
    expect(A.liveRound(s)!.matches[0].score).toEqual({ a: 11, b: 7 });
    s = A.endRound(s, 0);
    s = A.generatePreview(s, 3);
    expect([...onCourt(s), ...A.preview(s)!.sittingOut]).not.toContain(injured);
  });

  it('regenerates the preview when the roster changes', () => {
    let s = started(['A', 'B', 'C', 'D', 'E', 'F'], 1);
    s = A.generatePreview(s, 2);
    const leaving = onCourt(s)[0];
    s = A.setActive(s, leaving, false);
    expect(onCourt(s)).not.toContain(leaving);
  });

  it('swaps any two players in the preview, including one sitting out', () => {
    let s = started(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 1);
    s = A.generatePreview(s, 2);
    const benched = A.preview(s)!.sittingOut[0];
    const playing = onCourt(s)[0];
    s = A.swapPlayers(s, benched, playing);
    expect(A.preview(s)!.sittingOut).toEqual([playing]);
    expect(onCourt(s)[0]).toBe(benched);
  });

  it('only removes players without history; others are deactivated instead', () => {
    let s = started(['A', 'B'], 1);
    s = A.addPlayers(s, ['New']);
    const a = idOf(s, 'A');
    expect(A.removePlayer(s, a)).toBe(s);
    expect(A.removePlayer(s, idOf(s, 'New')).players).toHaveLength(2);
  });

  it('score taps adjust the stored value, so rapid taps never get lost', () => {
    let s = started(['A', 'B'], 0);
    s = A.generatePreview(s, 1);
    s = A.startRound(s);
    const r = A.liveRound(s)!;
    const m = r.matches[0];
    for (let i = 0; i < 5; i++) s = A.adjustMatchScore(s, r.id, m.id, 'a', (c) => (c ?? 0) + 1);
    s = A.adjustMatchScore(s, r.id, m.id, 'b', (c) => (c ?? 0) + 1);
    expect(A.liveRound(s)!.matches[0].score).toEqual({ a: 5, b: 1 });
  });

  it('clearing all rounds keeps players, courts and settings and starts the rotation afresh', () => {
    let s = started(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 3);
    s = A.addPlayers(s, ['Late']);
    s = A.setActive(s, idOf(s, 'Late'), false);
    const ties = unresolvedTies(computeStandings(s.players, s.rounds, s.settings.tiebreakers, s.playoffs));
    if (ties.length) s = A.createPlayoffs(s, ties, 1, 1);
    s = A.updateSettings(s, { allowDraws: true });
    s = A.generatePreview(s, 9);

    const cleared = A.clearRounds(s);
    expect(cleared.rounds).toEqual([]);
    expect(cleared.playoffs).toEqual([]);
    expect(cleared.players.map((p) => [p.id, p.name, p.active])).toEqual(s.players.map((p) => [p.id, p.name, p.active]));
    expect(cleared.players.every((p) => p.gamesCredit === 0 && p.sitCredit === 0 && !p.playNext)).toBe(true);
    expect(cleared.courts).toEqual(s.courts);
    expect(cleared.settings).toEqual(s.settings);
    expect(computeStandings(cleared.players, cleared.rounds, cleared.settings.tiebreakers, cleared.playoffs).rows.every((r) => r.position === null)).toBe(true);
    // 7 active players on 1D+1S again: the next round is a fresh rotation.
    expect(A.preview(A.generatePreview(cleared, 1))!.rotation?.step).toBe(0);
  });

  describe('editing a finished round\'s players', () => {
    function oneRound() {
      let s = A.addPlayers(A.newSession('t', 'd'), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Sub']);
      s = A.setActive(s, idOf(s, 'Sub'), false);
      s = A.generatePreview(s, 1);
      s = A.startRound(s);
      const r = A.liveRound(s)!;
      r.matches.forEach((m, i) => (s = A.setMatchScore(s, r.id, m.id, { a: 21, b: 10 + i })));
      return A.endRound(s, 0);
    }
    const stats = (s: Session) => new Map(computeStandings(s.players, s.rounds, s.settings.tiebreakers, s.playoffs).rows.map((r) => [r.playerId, r.stats]));

    it('swaps a player on court with one who sat out, moving the score credit with the slot', () => {
      let s = oneRound();
      const r = s.rounds[0];
      const winner = r.matches[0].sideA[0];
      const sitter = r.sittingOut[0];
      s = A.swapInRound(s, r.id, winner, sitter);
      const after = s.rounds[0];
      expect(after.matches[0].sideA[0]).toBe(sitter);
      expect(after.sittingOut).toEqual([winner]);
      expect(after.matches[0].score).toEqual(r.matches[0].score);
      expect(stats(s).get(sitter)!.wins).toBe(1);
      expect(stats(s).get(winner)!.matchesPlayed).toBe(0);
    });

    it('swaps players between courts and sides', () => {
      let s = oneRound();
      const r = s.rounds[0];
      const [d, sg] = [r.matches.find((m) => m.kind === 'doubles')!, r.matches.find((m) => m.kind === 'singles')!];
      s = A.swapInRound(s, r.id, d.sideB[1], sg.sideA[0]);
      const after = s.rounds[0];
      expect(after.matches.find((m) => m.kind === 'doubles')!.sideB[1]).toBe(sg.sideA[0]);
      expect(after.matches.find((m) => m.kind === 'singles')!.sideA[0]).toBe(d.sideB[1]);
    });

    it('brings in someone who was not in the round, taking the replaced player out of it', () => {
      let s = oneRound();
      const r = s.rounds[0];
      const injured = r.matches[0].sideB[0];
      const sub = idOf(s, 'Sub');
      s = A.swapInRound(s, r.id, injured, sub);
      const after = s.rounds[0];
      const everyone = [...after.matches.flatMap((m) => [...m.sideA, ...m.sideB]), ...after.sittingOut];
      expect(everyone).toContain(sub);
      expect(everyone).not.toContain(injured);
      expect(new Set(everyone).size).toBe(everyone.length);
      expect(stats(s).get(sub)!.matchesPlayed).toBe(1);
      expect(stats(s).get(injured)!.matchesPlayed).toBe(0);
    });

    it('ignores swaps between two people who were both outside the round', () => {
      let s = oneRound();
      s = A.addPlayers(s, ['Other']);
      s = A.setActive(s, idOf(s, 'Other'), false);
      expect(A.swapInRound(s, s.rounds[0].id, idOf(s, 'Sub'), idOf(s, 'Other'))).toBe(s);
    });

    it('ends a fixed rotation, so later rounds are planned from the edited history', () => {
      let s = A.addPlayers(A.newSession('t', 'd'), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
      s = A.generatePreview(s, 1);
      s = A.startRound(s);
      s = A.endRound(s, 0);
      expect(s.rounds[0].rotation?.step).toBe(0);
      const r = s.rounds[0];
      s = A.swapInRound(s, r.id, r.matches[0].sideA[0], r.sittingOut[0]);
      expect(s.rounds[0].rotation).toBeNull();
      expect(A.preview(A.generatePreview(s, 2))!.rotation ?? null).toBeNull();
    });
  });

  it('rejects draws unless enabled', () => {
    expect(A.scoreProblem({ a: 10, b: 10 }, false)).toMatch(/golden point/);
    expect(A.scoreProblem({ a: 10, b: 10 }, true)).toBeNull();
    expect(A.scoreProblem({ a: -1, b: 3 }, true)).toMatch(/whole numbers/);
  });

  it('timer survives pause/resume and counts from wall-clock time', () => {
    let s = started(['A', 'B'], 0);
    s = A.generatePreview(s, 1);
    s = A.startRound(s);
    s = A.startTimer(s, 1_000);
    s = A.pauseTimer(s, 61_000);
    s = A.startTimer(s, 100_000);
    expect(A.remainingMs(A.liveRound(s)!, 160_000)).toBe(12 * 60_000 - 120_000);
    s = A.resetTimer(s);
    expect(A.remainingMs(A.liveRound(s)!, 999_999)).toBe(12 * 60_000);
  });

  it('frees courts held by a playoff that goes stale after a score edit', () => {
    let s = started(['A', 'B', 'C', 'D', 'E', 'F'], 2);
    const ties = unresolvedTies(computeStandings(s.players, s.rounds, s.settings.tiebreakers, s.playoffs));
    s = A.createPlayoffs(s, ties, 1, 1);
    s = A.startPlayoffs(s, s.playoffs.map((p) => p.id));
    expect(s.playoffs.every((p) => p.matches[0].courtId)).toBe(true);
    // Edit every round-1 score so the ties break apart.
    const r1 = s.rounds[0];
    r1.matches.forEach((m, i) => (s = A.setMatchScore(s, r1.id, m.id, { a: 21, b: 3 + i * 5 })));
    const stale = A.stalePlayoffs(s);
    expect(stale.size).toBeGreaterThan(0);
    for (const p of s.playoffs) if (stale.has(p.id)) expect(p.matches[0].courtId).toBeNull();
  });
});
