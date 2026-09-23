import { rng, shuffle } from './rng';
import type { Court, Id, Playoff, PlayoffFormat, PlayoffKind, PlayoffMatch, Score, Settings, Source } from './types';

export interface NewPlayoff {
  id: Id;
  members: Id[];
  startPosition: number;
  format: PlayoffFormat;
  threePlayer: Settings['threePlayerPlayoff'];
  seed: number;
  createdAt: number;
}

const BYE: Source = { bye: true };

function ord(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** Standard bracket seed order, e.g. size 8 -> [0,7,3,4,1,6,2,5]. */
export function seedOrder(size: number): number[] {
  let order = [0];
  for (let s = 2; s <= size; s *= 2) order = order.flatMap((x) => [x, s - 1 - x]);
  return order;
}

function isBye(s: Source): boolean {
  return 'bye' in s;
}

/**
 * Classification bracket: each round's winners play on for the top half of the remaining
 * positions and losers for the bottom half, so every position is decided. Byes always lose.
 */
function buildKnockout(n: number, id: Id): { matches: PlayoffMatch[]; placements: Source[] } {
  let size = 1;
  while (size < n) size *= 2;
  const matches: PlayoffMatch[] = [];
  const label = (lo: number, span: number, k: number, count: number) => {
    const suffix = count > 1 ? ` ${k}` : '';
    if (span === 2) return lo === 1 ? 'Final' : `${ord(lo)} place`;
    if (lo === 1) return (span === 4 ? 'Semi-final' : span === 8 ? 'Quarter-final' : `Round of ${span}`) + suffix;
    return `Places ${lo}–${lo + span - 1}` + suffix;
  };
  const classify = (entrants: Source[], lo: number): Source[] => {
    if (entrants.length === 1) return entrants;
    const winners: Source[] = [];
    const losers: Source[] = [];
    const created: PlayoffMatch[] = [];
    for (let k = 0; k < entrants.length; k += 2) {
      const [a, b] = [entrants[k], entrants[k + 1]];
      if (isBye(a) || isBye(b)) {
        winners.push(isBye(a) ? b : a);
        losers.push(BYE);
        continue;
      }
      const m: PlayoffMatch = { id: `${id}-m${matches.length + 1}`, label: '', a, b, courtId: null, score: null };
      matches.push(m);
      created.push(m);
      winners.push({ winnerOf: m.id });
      losers.push({ loserOf: m.id });
    }
    created.forEach((m, k) => (m.label = label(lo, entrants.length, k + 1, created.length)));
    return [...classify(winners, lo), ...classify(losers, lo + entrants.length / 2)];
  };
  const entrants = seedOrder(size).map((s) => (s < n ? { seed: s } : BYE));
  return { matches, placements: classify(entrants, 1).filter((s) => !isBye(s)) };
}

function buildPlayoff(kind: PlayoffKind, n: number, id: Id): { matches: PlayoffMatch[]; placements: Source[] } {
  const m = (k: number, label: string, a: Source, b: Source): PlayoffMatch => ({
    id: `${id}-m${k}`,
    label,
    a,
    b,
    courtId: null,
    score: null,
  });
  switch (kind) {
    case 'single':
      return { matches: [m(1, 'Decider', { seed: 0 }, { seed: 1 })], placements: [{ winnerOf: `${id}-m1` }, { loserOf: `${id}-m1` }] };
    case 'knockout3':
      return {
        matches: [
          m(1, 'Opening match', { seed: 0 }, { seed: 1 }),
          m(2, 'Final', { winnerOf: `${id}-m1` }, { seed: 2 }),
          m(3, '2nd place', { loserOf: `${id}-m2` }, { loserOf: `${id}-m1` }),
        ],
        placements: [],
      };
    case 'roundRobin': {
      const matches: PlayoffMatch[] = [];
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) matches.push(m(matches.length + 1, `Round robin ${matches.length + 1}`, { seed: i }, { seed: j }));
      return { matches, placements: [] };
    }
    case 'knockout':
      return buildKnockout(n, id);
  }
}

function kindFor(n: number, threePlayer: Settings['threePlayerPlayoff']): PlayoffKind {
  if (n === 2) return 'single';
  if (n === 3) return threePlayer === 'roundRobin' ? 'roundRobin' : 'knockout3';
  return 'knockout';
}

export function createPlayoff(opts: NewPlayoff): Playoff {
  const members = [...opts.members].sort();
  const kind = kindFor(members.length, opts.threePlayer);
  const { matches, placements } = buildPlayoff(kind, members.length, opts.id);
  return {
    id: opts.id,
    members,
    startPosition: opts.startPosition,
    kind,
    seed: opts.seed,
    draw: shuffle(members, rng(opts.seed)),
    status: 'draw',
    format: opts.format,
    matches,
    placements,
    deciders: [],
    createdAt: opts.createdAt,
  };
}

export function redraw(p: Playoff, seed: number): Playoff {
  if (p.status !== 'draw') return p;
  return { ...p, seed, draw: shuffle(p.members, rng(seed)) };
}

function findMatch(p: Playoff, id: Id): PlayoffMatch | undefined {
  return p.matches.find((m) => m.id === id);
}

function winnerSide(score: Score): 'a' | 'b' | null {
  return score.a > score.b ? 'a' : score.b > score.a ? 'b' : null;
}

/** Resolves a source to a player id; null if it depends on an unplayed match. */
export function resolve(p: Playoff, s: Source): Id | null {
  if ('seed' in s) return p.draw[s.seed] ?? null;
  if ('bye' in s) return null;
  const mid = 'winnerOf' in s ? s.winnerOf : s.loserOf;
  const m = findMatch(p, mid);
  if (!m?.score) return null;
  const w = winnerSide(m.score);
  if (!w) return null;
  const side = 'winnerOf' in s ? w : w === 'a' ? 'b' : 'a';
  return resolve(p, side === 'a' ? m.a : m.b);
}

export function sides(p: Playoff, m: PlayoffMatch): [Id | null, Id | null] {
  return [resolve(p, m.a), resolve(p, m.b)];
}

/** knockout3's placement match is a rematch of the opener when the bye-holder wins the final. */
export function isSkipped(p: Playoff, m: PlayoffMatch): boolean {
  if (p.kind !== 'knockout3' || m.id !== p.matches[2].id) return false;
  const finalWinner = resolve(p, { winnerOf: p.matches[1].id });
  return finalWinner !== null && finalWinner === p.draw[2];
}

function roundRobinTable(p: Playoff): { id: Id; wins: number; diff: number }[] {
  const t = new Map(p.members.map((id) => [id, { id, wins: 0, diff: 0 }]));
  for (const m of p.matches) {
    if (!m.score) continue;
    const [a, b] = sides(p, m);
    if (!a || !b) continue;
    const ra = t.get(a)!;
    const rb = t.get(b)!;
    ra.diff += m.score.a - m.score.b;
    rb.diff += m.score.b - m.score.a;
    if (m.score.a > m.score.b) ra.wins++;
    else if (m.score.b > m.score.a) rb.wins++;
  }
  return [...t.values()];
}

/** Round-robin groups still level on wins then playoff points difference, in finishing order. */
function roundRobinGroups(p: Playoff): Id[][] {
  const rows = roundRobinTable(p).sort((x, y) => y.wins - x.wins || y.diff - x.diff);
  const groups: Id[][] = [];
  let prev: { wins: number; diff: number } | null = null;
  for (const r of rows) {
    if (prev && prev.wins === r.wins && prev.diff === r.diff) groups[groups.length - 1].push(r.id);
    else groups.push([r.id]);
    prev = r;
  }
  return groups;
}

/** Final order of the group (best first), or null while any deciding match is still to play. */
export function playoffOrder(p: Playoff): Id[] | null {
  switch (p.kind) {
    case 'single':
    case 'knockout': {
      const order = p.placements.map((s) => resolve(p, s));
      return order.every((id) => id !== null) ? (order as Id[]) : null;
    }
    case 'knockout3': {
      const [m1, m2, m3] = p.matches;
      if (!m1.score || !m2.score) return null;
      if (isSkipped(p, m3)) return [p.draw[2], resolve(p, { winnerOf: m1.id })!, resolve(p, { loserOf: m1.id })!];
      if (!m3.score) return null;
      return [resolve(p, { winnerOf: m2.id })!, resolve(p, { winnerOf: m3.id })!, resolve(p, { loserOf: m3.id })!];
    }
    case 'roundRobin': {
      if (p.matches.some((m) => !m.score)) return null;
      const out: Id[] = [];
      for (const g of roundRobinGroups(p)) {
        if (g.length === 1) {
          out.push(g[0]);
          continue;
        }
        const d = p.deciders.find((x) => x.members.join('|') === [...g].sort().join('|'));
        const order = d ? playoffOrder(d) : null;
        if (!order) return null;
        out.push(...order);
      }
      return out;
    }
  }
}

export function isComplete(p: Playoff): boolean {
  return playoffOrder(p) !== null;
}

/** Adds deciding-rally sub-playoffs for round-robin players still level (e.g. a 3-way cycle). */
function withDeciders(p: Playoff): Playoff {
  if (p.kind !== 'roundRobin' || p.matches.some((m) => !m.score)) return { ...p, deciders: [] };
  const deciders: Playoff[] = [];
  let k = 0;
  for (const g of roundRobinGroups(p)) {
    if (g.length < 2) continue;
    k++;
    const key = [...g].sort().join('|');
    const existing = p.deciders.find((d) => d.members.join('|') === key);
    deciders.push(
      existing ??
        {
          ...createPlayoff({
            id: `${p.id}-d${k}`,
            members: g,
            startPosition: 0,
            format: { kind: 'rally' },
            threePlayer: 'knockout',
            seed: (p.seed + k * 7919) >>> 0,
            createdAt: p.createdAt,
          }),
          status: 'live',
        },
    );
  }
  return { ...p, deciders };
}

/** Every match in the playoff including deciders, with the (sub-)playoff that owns it. */
export function allMatches(p: Playoff): { owner: Playoff; match: PlayoffMatch }[] {
  return [
    ...p.matches.filter((m) => !isSkipped(p, m)).map((match) => ({ owner: p, match })),
    ...p.deciders.flatMap(allMatches),
  ];
}

/** Matches whose players are both known and which haven't been played. */
export function readyMatches(p: Playoff): { owner: Playoff; match: PlayoffMatch }[] {
  if (p.status !== 'live') return [];
  return allMatches(p).filter(({ owner, match }) => {
    const [a, b] = sides(owner, match);
    return a !== null && b !== null && !match.score;
  });
}

function mapMatches(p: Playoff, fn: (m: PlayoffMatch, owner: Playoff) => PlayoffMatch): Playoff {
  return {
    ...p,
    matches: p.matches.map((m) => fn(m, p)),
    deciders: p.deciders.map((d) => mapMatches(d, fn)),
  };
}

/** Matches whose participants depend (directly or transitively) on `matchId`. */
function downstream(p: Playoff, matchId: Id): Set<Id> {
  const out = new Set<Id>();
  const feeds = (s: Source) => ('winnerOf' in s && out.has(s.winnerOf)) || ('loserOf' in s && out.has(s.loserOf));
  out.add(matchId);
  for (let grew = true; grew; ) {
    grew = false;
    for (const m of p.matches)
      if (!out.has(m.id) && (feeds(m.a) || feeds(m.b))) {
        out.add(m.id);
        grew = true;
      }
  }
  out.delete(matchId);
  return out;
}

/** Records (or clears) a score. A changed result resets dependent matches and rebuilds RR deciders. */
export function setPlayoffScore(p: Playoff, matchId: Id, score: Score | null): Playoff {
  const update = (pl: Playoff): Playoff => {
    const target = pl.matches.find((m) => m.id === matchId);
    if (!target) return { ...pl, deciders: pl.deciders.map(update) };
    const before = target.score ? winnerSide(target.score) : null;
    const after = score ? winnerSide(score) : null;
    const reset = before !== after ? downstream(pl, matchId) : new Set<Id>();
    const next = {
      ...pl,
      matches: pl.matches.map((m) =>
        m.id === matchId
          ? { ...m, score, progress: null }
          : reset.has(m.id)
            ? { ...m, score: null, courtId: null, progress: null }
            : m,
      ),
    };
    const rebuilt = before !== after && pl.kind === 'roundRobin' ? { ...next, deciders: [] } : next;
    return withDeciders(rebuilt);
  };
  const next = update(p);
  return { ...next, status: isComplete(next) ? 'done' : p.status === 'draw' ? 'draw' : 'live' };
}

/** Saves the running score of a playoff match without deciding it. */
export function setProgress(p: Playoff, matchId: Id, progress: Score): Playoff {
  return mapMatches(p, (m) => (m.id === matchId ? { ...m, progress } : m));
}

export function startPlayoff(p: Playoff): Playoff {
  return p.status === 'draw' ? { ...p, status: 'live' } : p;
}

/** Puts ready matches on free courts; a player is only ever on one court at a time. */
export function assignCourts(playoffs: Playoff[], courts: Court[], busyCourts: Set<Id> = new Set()): Playoff[] {
  const busy = new Set(busyCourts);
  const busyPlayers = new Set<Id>();
  for (const p of playoffs)
    for (const { owner, match } of allMatches(p))
      if (match.courtId && !match.score) {
        busy.add(match.courtId);
        for (const id of sides(owner, match)) if (id) busyPlayers.add(id);
      }
  const assign = new Map<Id, Id>();
  for (const p of [...playoffs].sort((a, b) => a.createdAt - b.createdAt))
    for (const { owner, match } of readyMatches(p)) {
      if (match.courtId) continue;
      const free = courts.find((c) => !busy.has(c.id));
      if (!free) break;
      const [a, b] = sides(owner, match) as [Id, Id];
      if (busyPlayers.has(a) || busyPlayers.has(b)) continue;
      assign.set(match.id, free.id);
      busy.add(free.id);
      busyPlayers.add(a);
      busyPlayers.add(b);
    }
  if (!assign.size) return playoffs;
  return playoffs.map((p) => mapMatches(p, (m) => (assign.has(m.id) ? { ...m, courtId: assign.get(m.id)! } : m)));
}

/** Who serves next under alternating serve: side A serves first, then every point alternates. */
export function servingSide(score: Score): 'a' | 'b' {
  return (score.a + score.b) % 2 === 0 ? 'a' : 'b';
}
