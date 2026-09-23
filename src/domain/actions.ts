// Pure session transitions. Each returns a new Session; the store persists and records undo.
import { allMatches, assignCourts, createPlayoff, redraw, setPlayoffScore, setProgress, startPlayoff } from './playoffs';
import { computeStandings, type TieGroup } from './ranking';
import { activationCredit, generateRound } from './scheduler';
import { computeStats, strengths } from './stats';
import { defaultSettings, type Court, type CourtKind, type Id, type Round, type Score, type Session, type Settings } from './types';

export function uid(): Id {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function newSession(name: string, date: string): Session {
  return {
    id: uid(),
    name,
    date,
    players: [],
    courts: [
      { id: uid(), name: 'Court 1', kind: 'doubles' },
      { id: uid(), name: 'Court 2', kind: 'singles' },
    ],
    settings: defaultSettings(),
    rounds: [],
    playoffs: [],
  };
}

export const preview = (s: Session): Round | undefined => s.rounds.find((r) => r.status === 'preview');
export const liveRound = (s: Session): Round | undefined => s.rounds.find((r) => r.status === 'live');
const hasStarted = (s: Session) => s.rounds.some((r) => r.status !== 'preview');

function mapRound(s: Session, id: Id, fn: (r: Round) => Round): Session {
  return { ...s, rounds: s.rounds.map((r) => (r.id === id ? fn(r) : r)) };
}

/** Rebuilds the preview (if any) after the roster, courts or settings change. */
function refreshPreview(s: Session): Session {
  const p = preview(s);
  return p ? generatePreview(s, p.seed) : s;
}

export function renameSession(s: Session, name: string, date: string): Session {
  return { ...s, name, date };
}

export function addPlayers(s: Session, names: string[]): Session {
  const existing = new Set(s.players.map((p) => p.name.toLowerCase()));
  let next = s;
  for (const raw of names) {
    const name = raw.trim();
    if (!name || existing.has(name.toLowerCase())) continue;
    existing.add(name.toLowerCase());
    const player = { id: uid(), name, active: true, gamesCredit: 0, sitCredit: 0, playNext: false };
    next = { ...next, players: [...next.players, player] };
    if (hasStarted(next)) next = activate(next, player.id);
  }
  return refreshPreview(next);
}

export function renamePlayer(s: Session, id: Id, name: string): Session {
  const trimmed = name.trim();
  if (!trimmed) return s;
  return { ...s, players: s.players.map((p) => (p.id === id ? { ...p, name: trimmed } : p)) };
}

export function hasHistory(s: Session, id: Id): boolean {
  return (
    s.rounds.some((r) => r.status !== 'preview' && (r.sittingOut.includes(id) || r.matches.some((m) => [...m.sideA, ...m.sideB].includes(id)))) ||
    s.playoffs.some((p) => p.members.includes(id))
  );
}

/** Players with history can only be deactivated, so their past matches stay intact. */
export function removePlayer(s: Session, id: Id): Session {
  if (hasHistory(s, id)) return s;
  return refreshPreview({ ...s, players: s.players.filter((p) => p.id !== id) });
}

function activate(s: Session, id: Id): Session {
  const players = s.players.map((p) => (p.id === id ? { ...p, active: true } : p));
  if (!hasStarted(s)) return { ...s, players };
  const { games, sits } = activationCredit(players, s.rounds, id);
  return { ...s, players: players.map((p) => (p.id === id ? { ...p, gamesCredit: games, sitCredit: sits, playNext: true } : p)) };
}

/**
 * Marks a player active/inactive between rounds (or withdraws them mid-round: their current
 * match keeps its score). The next-round preview is regenerated either way.
 */
export function setActive(s: Session, id: Id, active: boolean): Session {
  const next = active
    ? activate(s, id)
    : { ...s, players: s.players.map((p) => (p.id === id ? { ...p, active: false, playNext: false } : p)) };
  return refreshPreview(next);
}

export function addCourt(s: Session, kind: CourtKind): Session {
  const court: Court = { id: uid(), name: `Court ${s.courts.length + 1}`, kind };
  return refreshPreview({ ...s, courts: [...s.courts, court] });
}

export function updateCourt(s: Session, id: Id, patch: Partial<Omit<Court, 'id'>>): Session {
  return refreshPreview({ ...s, courts: s.courts.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
}

export function removeCourt(s: Session, id: Id): Session {
  if (liveRound(s)?.matches.some((m) => m.courtId === id)) return s;
  return refreshPreview({ ...s, courts: s.courts.filter((c) => c.id !== id) });
}

export function moveCourt(s: Session, id: Id, delta: -1 | 1): Session {
  const i = s.courts.findIndex((c) => c.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= s.courts.length) return s;
  const courts = [...s.courts];
  [courts[i], courts[j]] = [courts[j], courts[i]];
  return { ...s, courts };
}

const SCHEDULER_KEYS: (keyof Settings)[] = ['priorities', 'skillBalance', 'fillOrder', 'shortDoubles'];

export function updateSettings(s: Session, patch: Partial<Settings>): Session {
  const next = { ...s, settings: { ...s.settings, ...patch } };
  return SCHEDULER_KEYS.some((k) => k in patch) ? refreshPreview(next) : next;
}

export function generatePreview(s: Session, seed: number): Session {
  if (liveRound(s)) return s;
  const history = s.rounds.filter((r) => r.status !== 'preview');
  const proposal = generateRound({
    players: s.players,
    courts: s.courts,
    history,
    settings: s.settings,
    strength: s.settings.skillBalance ? strengths(computeStats(s.players, history)) : undefined,
    seed,
  });
  const round: Round = {
    id: preview(s)?.id ?? uid(),
    status: 'preview',
    seed,
    matches: proposal.matches.map((m) => ({ ...m, id: uid(), score: null })),
    sittingOut: proposal.sittingOut,
    timer: null,
  };
  return { ...s, rounds: [...history, round] };
}

export function discardPreview(s: Session): Session {
  return { ...s, rounds: s.rounds.filter((r) => r.status !== 'preview') };
}

/** Swaps two players' places in the preview (either may be sitting out). */
export function swapPlayers(s: Session, a: Id, b: Id): Session {
  const p = preview(s);
  if (!p || a === b) return s;
  const sw = (id: Id) => (id === a ? b : id === b ? a : id);
  return mapRound(s, p.id, (r) => ({
    ...r,
    matches: r.matches.map((m) => ({ ...m, sideA: m.sideA.map(sw), sideB: m.sideB.map(sw) })),
    sittingOut: r.sittingOut.map(sw),
  }));
}

export function startRound(s: Session): Session {
  const p = preview(s);
  if (!p || liveRound(s)) return s;
  const onCourt = new Set(p.matches.flatMap((m) => [...m.sideA, ...m.sideB]));
  const f = s.settings.format;
  const timer = f.kind === 'timed' ? { durationMs: f.minutes * 60_000, runningSince: null, accumulatedMs: 0, alerted: false } : null;
  return {
    ...mapRound(s, p.id, (r) => ({ ...r, status: 'live', timer })),
    players: s.players.map((pl) => (onCourt.has(pl.id) ? { ...pl, playNext: false } : pl)),
  };
}

export function remainingMs(r: Round, now: number): number {
  const t = r.timer;
  if (!t) return 0;
  const elapsed = t.accumulatedMs + (t.runningSince !== null ? now - t.runningSince : 0);
  return Math.max(0, t.durationMs - elapsed);
}

export function startTimer(s: Session, now: number): Session {
  const r = liveRound(s);
  if (!r?.timer || r.timer.runningSince !== null) return s;
  return mapRound(s, r.id, (x) => ({ ...x, timer: { ...x.timer!, runningSince: now } }));
}

export function pauseTimer(s: Session, now: number): Session {
  const r = liveRound(s);
  if (!r?.timer || r.timer.runningSince === null) return s;
  const t = r.timer;
  return mapRound(s, r.id, (x) => ({ ...x, timer: { ...t, runningSince: null, accumulatedMs: t.accumulatedMs + (now - t.runningSince!) } }));
}

export function resetTimer(s: Session): Session {
  const r = liveRound(s);
  if (!r?.timer) return s;
  return mapRound(s, r.id, (x) => ({ ...x, timer: { ...x.timer!, runningSince: null, accumulatedMs: 0, alerted: false } }));
}

export function markAlerted(s: Session): Session {
  const r = liveRound(s);
  if (!r?.timer) return s;
  return mapRound(s, r.id, (x) => ({ ...x, timer: { ...x.timer!, alerted: true } }));
}

/** Why a score can't be saved, or null if it's fine. */
export function scoreProblem(score: Score, allowDraws: boolean): string | null {
  if (![score.a, score.b].every((n) => Number.isInteger(n) && n >= 0)) return 'Scores must be whole numbers';
  if (!allowDraws && score.a === score.b) return 'Draws are off — golden point: who won the deciding rally?';
  return null;
}

export function setMatchScore(s: Session, roundId: Id, matchId: Id, score: Score | null): Session {
  return schedulePlayoffs(mapRound(s, roundId, (r) => ({ ...r, matches: r.matches.map((m) => (m.id === matchId ? { ...m, score } : m)) })));
}

export type Side = 'a' | 'b';
export type Adjust = (current: number | null) => number;

function adjusted(score: Score | null | undefined, side: Side, f: Adjust): Score {
  const next = f(score ? score[side] : null);
  const other = score ? score[side === 'a' ? 'b' : 'a'] : 0;
  return side === 'a' ? { a: next, b: other } : { a: other, b: next };
}

/** Changes one side's score relative to the stored value (safe for rapid repeated taps). */
export function adjustMatchScore(s: Session, roundId: Id, matchId: Id, side: Side, f: Adjust): Session {
  const m = s.rounds.find((r) => r.id === roundId)?.matches.find((x) => x.id === matchId);
  return m ? setMatchScore(s, roundId, matchId, adjusted(m.score, side, f)) : s;
}

export function adjustPlayoffProgress(s: Session, playoffId: Id, matchId: Id, side: Side, f: Adjust): Session {
  const p = s.playoffs.find((x) => x.id === playoffId);
  const m = p && allMatches(p).find(({ match }) => match.id === matchId)?.match;
  return m ? setPlayoffProgress(s, playoffId, matchId, adjusted(m.progress ?? { a: 0, b: 0 }, side, f)) : s;
}

export function endRound(s: Session, now: number): Session {
  const r = liveRound(s);
  if (!r) return s;
  const paused = pauseTimer(s, now);
  return schedulePlayoffs(mapRound(paused, r.id, (x) => ({ ...x, status: 'done' })));
}

export function deleteRound(s: Session, roundId: Id): Session {
  return schedulePlayoffs({ ...s, rounds: s.rounds.filter((r) => r.id !== roundId) });
}

// ---- Playoffs --------------------------------------------------------------

export function stalePlayoffs(s: Session): Set<Id> {
  return computeStandings(s.players, s.rounds, s.settings.tiebreakers, s.playoffs).stale;
}

/** Frees courts held by stale playoffs, then puts ready playoff matches on free courts. */
function schedulePlayoffs(s: Session): Session {
  if (!s.playoffs.length) return s;
  const stale = stalePlayoffs(s);
  const freed = s.playoffs.map((p) => {
    if (!stale.has(p.id) || !allMatches(p).some(({ match }) => match.courtId && !match.score)) return p;
    const clear = (pl: typeof p): typeof p => ({
      ...pl,
      matches: pl.matches.map((m) => (m.score ? m : { ...m, courtId: null })),
      deciders: pl.deciders.map(clear),
    });
    return clear(p);
  });
  const live = liveRound(s);
  const busy = new Set(live ? live.matches.map((m) => m.courtId) : []);
  const active = assignCourts(freed.filter((p) => !stale.has(p.id)), s.courts, busy);
  return { ...s, playoffs: freed.map((p) => active.find((a) => a.id === p.id) ?? p) };
}

export function createPlayoffs(s: Session, groups: TieGroup[], now: number, seed: number): Session {
  const created = groups.map((g, i) =>
    createPlayoff({
      id: uid(),
      members: g.members,
      startPosition: g.position,
      format: s.settings.playoffFormat,
      threePlayer: s.settings.threePlayerPlayoff,
      seed: (seed + i * 7919) >>> 0,
      createdAt: now + i,
    }),
  );
  return { ...s, playoffs: [...s.playoffs, ...created] };
}

export function redrawPlayoff(s: Session, id: Id, seed: number): Session {
  return { ...s, playoffs: s.playoffs.map((p) => (p.id === id ? redraw(p, seed) : p)) };
}

export function startPlayoffs(s: Session, ids: Id[]): Session {
  return schedulePlayoffs({ ...s, playoffs: s.playoffs.map((p) => (ids.includes(p.id) ? startPlayoff(p) : p)) });
}

export function setPlayoffMatchScore(s: Session, playoffId: Id, matchId: Id, score: Score | null): Session {
  return schedulePlayoffs({
    ...s,
    playoffs: s.playoffs.map((p) => (p.id === playoffId ? setPlayoffScore(p, matchId, score) : p)),
  });
}

export function setPlayoffProgress(s: Session, playoffId: Id, matchId: Id, progress: Score): Session {
  return { ...s, playoffs: s.playoffs.map((p) => (p.id === playoffId ? setProgress(p, matchId, progress) : p)) };
}

export function deletePlayoff(s: Session, id: Id): Session {
  return schedulePlayoffs({ ...s, playoffs: s.playoffs.filter((p) => p.id !== id) });
}
