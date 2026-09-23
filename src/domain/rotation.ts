// Fixed "move one place along" rotations for group sizes where a fully fair circle layout exists.
// Pure and deterministic for a given seed, like the scheduler.
import { rng, shuffle } from './rng';
import type { ProposedMatch } from './scheduler';
import type { Court, CourtKind, Id, Player, RotationInfo, Round } from './types';

interface CircleLayout {
  courts: CourtKind[];
  doubles: [number, number][][];
  singles: [number, number][];
  bench: number[];
  /** Rounds before the pattern starts repeating itself. */
  rounds: number;
}

// 7 players, 1D+1S: team gaps 1 and 2 never repeat a team, non-adjacent singles spots (gap 3) avoid
// back-to-back singles, and one bench seat sits everyone once per 7 rounds. See README.
const SEVEN_ONE_DOUBLES_ONE_SINGLES: CircleLayout = {
  courts: ['doubles', 'singles'],
  doubles: [
    [
      [0, 1],
      [2, 4],
    ],
  ],
  singles: [[3, 6]],
  bench: [5],
  rounds: 7,
};

const LAYOUTS = [SEVEN_ONE_DOUBLES_ONE_SINGLES];

function layoutFor(playerCount: number, courts: Court[]): CircleLayout | null {
  const kinds = courts.map((c) => c.kind).sort();
  return (
    LAYOUTS.find((l) => l.bench.length + l.doubles.length * 4 + l.singles.length * 2 === playerCount && [...l.courts].sort().join() === kinds.join()) ??
    null
  );
}

export interface RotationRound {
  matches: ProposedMatch[];
  sittingOut: Id[];
  rotation: RotationInfo;
}

function build(layout: CircleLayout, courts: Court[], info: RotationInfo): RotationRound {
  const n = info.order.length;
  const at = (pos: number) => info.order[(((pos - info.step) % n) + n) % n];
  const doublesCourts = courts.filter((c) => c.kind === 'doubles');
  const singlesCourts = courts.filter((c) => c.kind === 'singles');
  const byCourt = new Map<Id, ProposedMatch>();
  layout.doubles.forEach(([[a1, a2], [b1, b2]], i) =>
    byCourt.set(doublesCourts[i].id, { courtId: doublesCourts[i].id, kind: 'doubles', sideA: [at(a1), at(a2)], sideB: [at(b1), at(b2)] }),
  );
  layout.singles.forEach(([a, b], i) => byCourt.set(singlesCourts[i].id, { courtId: singlesCourts[i].id, kind: 'singles', sideA: [at(a)], sideB: [at(b)] }));
  return { matches: courts.map((c) => byCourt.get(c.id)!), sittingOut: layout.bench.map(at), rotation: info };
}

/** Next rotation round, or null if no layout fits, the rotation was broken, or the cycle is used up. */
export function nextRotationRound(players: Player[], courts: Court[], history: Round[], seed: number): RotationRound | null {
  const active = players.filter((p) => p.active).map((p) => p.id);
  const layout = layoutFor(active.length, courts);
  if (!layout) return null;
  const rounds = history.filter((r) => r.status !== 'preview');
  if (!rounds.length) return build(layout, courts, { order: shuffle(active, rng(seed)), step: 0 });
  // Continue only an unbroken rotation from round 1 with the same players.
  if (rounds.some((r) => !r.rotation)) return null;
  const last = rounds[rounds.length - 1].rotation!;
  const step = last.step + 1;
  if (step !== rounds.length || step >= layout.rounds) return null;
  if ([...last.order].sort().join() !== [...active].sort().join()) return null;
  return build(layout, courts, { order: last.order, step });
}

export function rotationLength(playerCount: number, courts: Court[]): number | null {
  return layoutFor(playerCount, courts)?.rounds ?? null;
}
