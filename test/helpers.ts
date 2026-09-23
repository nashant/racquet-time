import type { Court, CourtKind, Id, Match, Player, Round, Score, Settings } from '../src/domain/types';
import { defaultSettings } from '../src/domain/types';
import { generateRound, type ScheduleRequest } from '../src/domain/scheduler';

export function makePlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Player ${i + 1}`,
    active: true,
    gamesCredit: 0,
    sitCredit: 0,
    playNext: false,
  }));
}

export function makeCourts(kinds: CourtKind[]): Court[] {
  return kinds.map((kind, i) => ({ id: `c${i + 1}`, name: `Court ${i + 1}`, kind }));
}

let matchSeq = 0;

/** Schedules a round and appends it to history as a finished round (scores optional). */
export function playRound(
  req: Omit<ScheduleRequest, 'seed'>,
  seed: number,
  scorer?: (m: Omit<Match, 'id' | 'score'>) => Score | null,
): Round {
  const p = generateRound({ ...req, seed });
  return {
    id: `r${req.history.length + 1}`,
    status: 'done',
    seed,
    sittingOut: p.sittingOut,
    timer: null,
    matches: p.matches.map((m) => ({ ...m, id: `m${++matchSeq}`, score: scorer ? scorer(m) : null })),
  };
}

export function simulate(
  players: Player[],
  courts: Court[],
  rounds: number,
  settings: Partial<Settings> = {},
  seed = 1,
): Round[] {
  const history: Round[] = [];
  const s = { ...defaultSettings(), ...settings };
  for (let r = 0; r < rounds; r++) {
    history.push(playRound({ players, courts, history, settings: s }, seed + r));
  }
  return history;
}

export function onCourt(round: Round): Id[] {
  return round.matches.flatMap((m) => [...m.sideA, ...m.sideB]);
}

export function counts(history: Round[], pick: (r: Round) => Id[]): Map<Id, number> {
  const c = new Map<Id, number>();
  for (const r of history) for (const id of pick(r)) c.set(id, (c.get(id) ?? 0) + 1);
  return c;
}

export function pairKey(a: Id, b: Id): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function partnerCounts(history: Round[]): Map<string, number> {
  const c = new Map<string, number>();
  for (const r of history)
    for (const m of r.matches)
      for (const side of [m.sideA, m.sideB])
        if (side.length === 2) {
          const k = pairKey(side[0], side[1]);
          c.set(k, (c.get(k) ?? 0) + 1);
        }
  return c;
}

export function score(a: number, b: number): Score {
  return { a, b };
}
