import type { Id, Match, Metric, Player, Round } from './types';

export interface PlayerStats {
  playerId: Id;
  matchesPlayed: number;
  singles: number;
  doubles: number;
  wins: number;
  draws: number;
  losses: number;
  winPct: number;
  pointsFor: number;
  pointsAgainst: number;
  pointsDiff: number;
  avgPointsDiff: number;
  /** Rounds on court, scored or not (what the rotation balances). */
  appearances: number;
}

export interface MatchResult {
  roundIndex: number;
  match: Match;
  side: 'A' | 'B';
  outcome: 'win' | 'draw' | 'loss' | 'unscored';
}

function empty(playerId: Id): PlayerStats {
  return {
    playerId,
    matchesPlayed: 0,
    singles: 0,
    doubles: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    winPct: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointsDiff: 0,
    avgPointsDiff: 0,
    appearances: 0,
  };
}

export function scoredRounds(rounds: Round[]): Round[] {
  return rounds.filter((r) => r.status !== 'preview');
}

/** Session statistics. Only scored matches count; playoffs never feed in here. */
export function computeStats(players: Player[], rounds: Round[]): Map<Id, PlayerStats> {
  const stats = new Map(players.map((p) => [p.id, empty(p.id)]));
  for (const round of scoredRounds(rounds))
    for (const m of round.matches)
      for (const [side, other, pf, pa] of [
        [m.sideA, m.sideB, m.score?.a, m.score?.b],
        [m.sideB, m.sideA, m.score?.b, m.score?.a],
      ] as const) {
        void other;
        for (const id of side) {
          const s = stats.get(id);
          if (!s) continue;
          s.appearances++;
          if (pf === undefined || pa === undefined) continue;
          s.matchesPlayed++;
          if (m.kind === 'singles') s.singles++;
          else s.doubles++;
          s.pointsFor += pf;
          s.pointsAgainst += pa;
          if (pf > pa) s.wins++;
          else if (pf < pa) s.losses++;
          else s.draws++;
        }
      }
  for (const s of stats.values()) {
    s.pointsDiff = s.pointsFor - s.pointsAgainst;
    s.winPct = s.matchesPlayed ? (s.wins + 0.5 * s.draws) / s.matchesPlayed : 0;
    s.avgPointsDiff = s.matchesPlayed ? s.pointsDiff / s.matchesPlayed : 0;
  }
  return stats;
}

export function metricValue(s: PlayerStats, m: Metric): number {
  return s[m];
}

export function playerMatches(playerId: Id, rounds: Round[]): MatchResult[] {
  const out: MatchResult[] = [];
  scoredRounds(rounds).forEach((round, roundIndex) => {
    for (const match of round.matches) {
      const side = match.sideA.includes(playerId) ? 'A' : match.sideB.includes(playerId) ? 'B' : null;
      if (!side) continue;
      let outcome: MatchResult['outcome'] = 'unscored';
      if (match.score) {
        const [mine, theirs] = side === 'A' ? [match.score.a, match.score.b] : [match.score.b, match.score.a];
        outcome = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
      }
      out.push({ roundIndex, match, side, outcome });
    }
  });
  return out;
}

/** Strength in (0, 1) for skill balancing: win rate with a +1/+2 prior. */
export function strengths(stats: Map<Id, PlayerStats>): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const s of stats.values()) out[s.playerId] = (s.wins + 0.5 * s.draws + 1) / (s.matchesPlayed + 2);
  return out;
}
