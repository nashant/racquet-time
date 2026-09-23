import type { Court, CourtKind, Id, Settings } from './types';

export interface CourtPlan {
  courtId: Id;
  kind: CourtKind;
  /** True when a doubles court runs as singles because there aren't enough players. */
  downgraded: boolean;
}

export const CAPACITY: Record<CourtKind, number> = { singles: 2, doubles: 4 };

/**
 * Decides which courts run this round, and as what, for `n` available players.
 * Courts are filled in `fillOrder`; the result is returned in the original court order.
 */
export function planLayout(
  n: number,
  courts: Court[],
  fillOrder: Settings['fillOrder'],
  shortDoubles: Settings['shortDoubles'],
): CourtPlan[] {
  const first: CourtKind = fillOrder === 'doublesFirst' ? 'doubles' : 'singles';
  const ordered = [...courts.filter((c) => c.kind === first), ...courts.filter((c) => c.kind !== first)];
  let remaining = n;
  const plans = new Map<Id, CourtPlan>();
  for (const court of ordered) {
    if (court.kind === 'doubles' && remaining >= 4) {
      plans.set(court.id, { courtId: court.id, kind: 'doubles', downgraded: false });
      remaining -= 4;
    } else if (court.kind === 'doubles' && remaining >= 2 && shortDoubles === 'asSingles') {
      plans.set(court.id, { courtId: court.id, kind: 'singles', downgraded: true });
      remaining -= 2;
    } else if (court.kind === 'singles' && remaining >= 2) {
      plans.set(court.id, { courtId: court.id, kind: 'singles', downgraded: false });
      remaining -= 2;
    }
  }
  return courts.flatMap((c) => plans.get(c.id) ?? []);
}
