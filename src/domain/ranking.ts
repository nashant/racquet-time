import { isComplete, playoffOrder } from './playoffs';
import { computeStats, metricValue, scoredRounds, type PlayerStats } from './stats';
import type { Id, Player, Playoff, Round, Tiebreaker } from './types';

export interface RankRow {
  playerId: Id;
  stats: PlayerStats;
  /** 1-based position, null when the player has no scored matches. */
  position: number | null;
  label: string;
  /** Index of the tie group this row belongs to (for a shared highlight colour). */
  tieGroup: number | null;
  viaPlayoff: boolean;
}

export interface TieGroup {
  key: string;
  members: Id[];
  position: number;
  /** A valid playoff that has fully resolved this group. */
  resolvedBy: Id | null;
  /** A valid playoff that is under way (draw or live) for this group. */
  inProgress: Id | null;
}

export interface Standings {
  rows: RankRow[];
  /** Every group still exactly level after tiebreakers (before playoffs are applied). */
  ties: TieGroup[];
  /** Ids of playoffs whose group no longer exists. */
  stale: Set<Id>;
}

const EPS = 1e-9;

export function groupKey(ids: Id[]): string {
  return [...ids].sort().join('|');
}

export function ordinal(n: number): string {
  const s = n % 100;
  if (s >= 11 && s <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** Head-to-head within `group`: wins minus losses in scored matches against other group members. */
function headToHead(group: Id[], rounds: Round[]): Map<Id, number> {
  const inGroup = new Set(group);
  const h = new Map(group.map((id) => [id, 0]));
  for (const r of scoredRounds(rounds))
    for (const m of r.matches) {
      if (!m.score || m.score.a === m.score.b) continue;
      const [winners, losers] = m.score.a > m.score.b ? [m.sideA, m.sideB] : [m.sideB, m.sideA];
      const winnersFaceGroup = losers.some((id) => inGroup.has(id));
      const losersFaceGroup = winners.some((id) => inGroup.has(id));
      for (const id of winners) if (inGroup.has(id) && winnersFaceGroup) h.set(id, h.get(id)! + 1);
      for (const id of losers) if (inGroup.has(id) && losersFaceGroup) h.set(id, h.get(id)! - 1);
    }
  return h;
}

function splitBy(group: Id[], value: (id: Id) => number): Id[][] {
  const sorted = [...group].sort((a, b) => value(b) - value(a));
  const out: Id[][] = [];
  for (const id of sorted) {
    const last = out[out.length - 1];
    if (last && Math.abs(value(last[0]) - value(id)) < EPS) last.push(id);
    else out.push([id]);
  }
  return out;
}

/** Orders ranked players into groups; players in the same group are exactly level. */
export function rankGroups(
  ids: Id[],
  stats: Map<Id, PlayerStats>,
  rounds: Round[],
  tiebreakers: Tiebreaker[],
): Id[][] {
  let groups: Id[][] = ids.length ? [ids] : [];
  for (const tb of tiebreakers) {
    groups = groups.flatMap((g) => {
      if (g.length < 2) return [g];
      if (tb === 'headToHead') {
        const h = headToHead(g, rounds);
        return splitBy(g, (id) => h.get(id)!);
      }
      return splitBy(g, (id) => metricValue(stats.get(id)!, tb));
    });
  }
  // Stable, readable order inside a tie.
  return groups.map((g) => (g.length > 1 ? [...g].sort() : g));
}

export function computeStandings(
  players: Player[],
  rounds: Round[],
  tiebreakers: Tiebreaker[],
  playoffs: Playoff[],
): Standings {
  const stats = computeStats(players, rounds);
  const nameOf = new Map(players.map((p) => [p.id, p.name]));
  const ranked = players.filter((p) => stats.get(p.id)!.matchesPlayed > 0).map((p) => p.id);
  const groups = rankGroups(ranked, stats, rounds, tiebreakers);

  // The most recently created playoff for each current group key wins; any playoff whose
  // member set is not a current group is stale and never applied.
  const byKey = new Map<string, Playoff>();
  const stale = new Set<Id>();
  const currentKeys = new Set(groups.filter((g) => g.length > 1).map(groupKey));
  for (const p of [...playoffs].sort((a, b) => a.createdAt - b.createdAt)) {
    const key = groupKey(p.members);
    if (currentKeys.has(key)) byKey.set(key, p);
    else stale.add(p.id);
  }

  const rows: RankRow[] = [];
  const ties: TieGroup[] = [];
  let position = 1;
  for (const g of groups) {
    if (g.length === 1) {
      rows.push({ playerId: g[0], stats: stats.get(g[0])!, position, label: ordinal(position), tieGroup: null, viaPlayoff: false });
    } else {
      const key = groupKey(g);
      const playoff = byKey.get(key) ?? null;
      const done = playoff && isComplete(playoff) ? playoffOrder(playoff) : null;
      ties.push({
        key,
        members: g,
        position,
        resolvedBy: done ? playoff!.id : null,
        inProgress: playoff && !done ? playoff.id : null,
      });
      if (done) {
        done.forEach((id, i) =>
          rows.push({
            playerId: id,
            stats: stats.get(id)!,
            position: position + i,
            label: `${ordinal(position + i)} (playoff)`,
            tieGroup: null,
            viaPlayoff: true,
          }),
        );
      } else {
        const tieGroup = ties.filter((t) => !t.resolvedBy).length - 1;
        for (const id of [...g].sort((a, b) => nameOf.get(a)!.localeCompare(nameOf.get(b)!)))
          rows.push({ playerId: id, stats: stats.get(id)!, position, label: `=${ordinal(position)}`, tieGroup, viaPlayoff: false });
      }
    }
    position += g.length;
  }
  for (const p of players)
    if (!stats.get(p.id)!.matchesPlayed)
      rows.push({ playerId: p.id, stats: stats.get(p.id)!, position: null, label: '—', tieGroup: null, viaPlayoff: false });
  return { rows, ties, stale };
}

/** Tie groups that still need a playoff (no valid complete or in-progress one). */
export function unresolvedTies(standings: Standings): TieGroup[] {
  return standings.ties.filter((t) => !t.resolvedBy && !t.inProgress);
}
