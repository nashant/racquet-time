// Structural validation for data coming from localStorage or an imported file.
import type { Session } from '../domain/types';

type Check = (v: unknown, path: string) => string | null;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const str: Check = (v, p) => (typeof v === 'string' ? null : `${p} should be text`);
const num: Check = (v, p) => (typeof v === 'number' && Number.isFinite(v) ? null : `${p} should be a number`);
const bool: Check = (v, p) => (typeof v === 'boolean' ? null : `${p} should be true/false`);
const oneOf = (...values: string[]): Check => (v, p) => (values.includes(v as string) ? null : `${p} should be one of ${values.join(', ')}`);
const nullable = (c: Check): Check => (v, p) => (v === null ? null : c(v, p));
const arr = (c: Check): Check => (v, p) => {
  if (!Array.isArray(v)) return `${p} should be a list`;
  for (let i = 0; i < v.length; i++) {
    const e = c(v[i], `${p}[${i}]`);
    if (e) return e;
  }
  return null;
};
const obj = (shape: Record<string, Check>): Check => (v, p) => {
  if (!isObj(v)) return `${p} should be an object`;
  for (const [k, c] of Object.entries(shape)) {
    const e = c(v[k], `${p}.${k}`);
    if (e) return e;
  }
  return null;
};
const optional = (c: Check): Check => (v, p) => (v === undefined ? null : c(v, p));
const lazy = (f: () => Check): Check => (v, p) => f()(v, p);

const score = nullable(obj({ a: num, b: num }));
const source: Check = (v, p) =>
  isObj(v) && (typeof v.seed === 'number' || typeof v.winnerOf === 'string' || typeof v.loserOf === 'string' || v.bye === true)
    ? null
    : `${p} is not a valid bracket slot`;

const playoff: Check = obj({
  id: str,
  members: arr(str),
  startPosition: num,
  kind: oneOf('single', 'knockout', 'knockout3', 'roundRobin'),
  seed: num,
  draw: arr(str),
  status: oneOf('draw', 'live', 'done'),
  format: obj({ kind: oneOf('points', 'rally') }),
  matches: arr(obj({ id: str, label: str, a: source, b: source, courtId: nullable(str), score, progress: optional(score) })),
  placements: arr(source),
  deciders: arr(lazy(() => playoff)),
  createdAt: num,
});

const session: Check = obj({
  id: str,
  name: str,
  date: str,
  players: arr(obj({ id: str, name: str, active: bool, gamesCredit: num, sitCredit: num, playNext: bool })),
  courts: arr(obj({ id: str, name: str, kind: oneOf('singles', 'doubles') })),
  settings: obj({
    format: obj({ kind: oneOf('timed', 'points') }),
    allowDraws: bool,
    tiebreakers: arr(oneOf('wins', 'winPct', 'pointsDiff', 'avgPointsDiff', 'pointsFor', 'matchesPlayed', 'headToHead')),
    priorities: arr(oneOf('equalGames', 'singlesShare', 'noConsecutiveSingles', 'partnerVariety', 'opponentVariety', 'skillBalance')),
    skillBalance: bool,
    fillOrder: oneOf('doublesFirst', 'singlesFirst'),
    shortDoubles: oneOf('asSingles', 'leaveEmpty'),
    playoffFormat: obj({ kind: oneOf('points', 'rally') }),
    threePlayerPlayoff: oneOf('roundRobin', 'knockout'),
  }),
  rounds: arr(
    obj({
      id: str,
      status: oneOf('preview', 'live', 'done'),
      seed: num,
      matches: arr(obj({ id: str, courtId: str, kind: oneOf('singles', 'doubles'), sideA: arr(str), sideB: arr(str), score })),
      sittingOut: arr(str),
      timer: nullable(obj({ durationMs: num, runningSince: nullable(num), accumulatedMs: num, alerted: bool })),
    }),
  ),
  playoffs: arr(playoff),
});

/** Returns the first problem found, or null if `v` is a structurally valid Session. */
export function sessionProblem(v: unknown): string | null {
  const shape = session(v, 'session');
  if (shape) return shape;
  const s = v as Session;
  const ids = new Set(s.players.map((p) => p.id));
  for (const r of s.rounds)
    for (const id of [...r.sittingOut, ...r.matches.flatMap((m) => [...m.sideA, ...m.sideB])])
      if (!ids.has(id)) return `a round refers to an unknown player (${id})`;
  for (const p of s.playoffs) for (const id of p.members) if (!ids.has(id)) return `a playoff refers to an unknown player (${id})`;
  return null;
}
