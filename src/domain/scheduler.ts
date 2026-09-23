// Pure and deterministic for a given seed (no DOM, clock or Math.random). See README for the algorithm.
import { planLayout, type CourtPlan } from './layout';
import { rng, shuffle } from './rng';
import type { Court, CourtKind, Id, Player, Priority, Round, Settings } from './types';

export interface ScheduleRequest {
  players: Player[];
  courts: Court[];
  /** Full session history in order. Preview rounds are ignored. */
  history: Round[];
  settings: Pick<Settings, 'priorities' | 'skillBalance' | 'fillOrder' | 'shortDoubles'>;
  /** Player strength in [0, 1], used only when skill balance is on. */
  strength?: Record<Id, number>;
  seed: number;
}

export interface ProposedMatch {
  courtId: Id;
  kind: CourtKind;
  sideA: Id[];
  sideB: Id[];
}

export type Breakdown = Record<Priority, number>;

/** Rule breaks the scheduler only accepts when every alternative breaks them too. */
export interface Violations {
  repeatTeams: number;
  repeatSingles: number;
  singlesAhead: number;
}

export interface Proposal {
  matches: ProposedMatch[];
  sittingOut: Id[];
  /** Court ids of doubles courts running as singles this round. */
  downgraded: Id[];
  cost: number;
  breakdown: Breakdown;
  violations: Violations;
}

/** Penalty for breaking an "if avoidable" rule inside the equal-games term. */
const Q = 50;
/** Per-violation penalty for the near-hard rules; dwarfs every weighted priority. */
const HARD = 1e9;
const RESTARTS = 24;
const STEPS = 1500;

interface Context {
  ids: Id[];
  n: number;
  eff: Float64Array;
  effMax: number;
  /** Sit-outs over rounds present, plus any credit from (re)activation. */
  sits: Float64Array;
  singles: Float64Array;
  minSingles: number;
  expected: Float64Array;
  satOutLast: Uint8Array;
  singlesLast: Uint8Array;
  playNext: Uint8Array;
  /** Rounds since the player last sat out (0 = never). */
  sitAgo: Float64Array;
  partner: Int16Array;
  opp: Int16Array;
  /** Times two players have met in a singles match. */
  singlesOpp: Int16Array;
  strength: Float64Array;
  weights: Breakdown;
}

interface Layout {
  plan: { courtId: Id; kind: CourtKind }[];
  /** Slot offset of each court in the assignment array. */
  offsets: number[];
  playing: number;
  singlesRatio: number;
}

/** Hard rule keeping sit-outs within 1: below the k-th lowest count must sit, above it must play. */
interface Bench {
  mustSit: Uint8Array;
  swappable: Uint8Array;
}

function played(history: Round[]): Round[] {
  return history.filter((r) => r.status !== 'preview');
}

function weightsFor(settings: ScheduleRequest['settings']): Breakdown {
  const w = {} as Breakdown;
  const order = settings.priorities;
  order.forEach((p, i) => (w[p] = 6 ** (order.length - 1 - i)));
  if (!settings.skillBalance) w.skillBalance = 0;
  return w;
}

function buildContext(req: ScheduleRequest): Context {
  const ids = req.players.filter((p) => p.active).map((p) => p.id);
  const n = ids.length;
  const index = new Map(ids.map((id, i) => [id, i]));
  const ctx: Context = {
    ids,
    n,
    eff: new Float64Array(n),
    effMax: 0,
    sits: new Float64Array(n),
    singles: new Float64Array(n),
    minSingles: 0,
    expected: new Float64Array(n),
    satOutLast: new Uint8Array(n),
    singlesLast: new Uint8Array(n),
    playNext: new Uint8Array(n),
    sitAgo: new Float64Array(n),
    partner: new Int16Array(n * n),
    opp: new Int16Array(n * n),
    singlesOpp: new Int16Array(n * n),
    strength: new Float64Array(n),
    weights: weightsFor(req.settings),
  };
  for (const p of req.players) {
    const i = index.get(p.id);
    if (i === undefined) continue;
    ctx.eff[i] = p.gamesCredit;
    ctx.sits[i] = p.sitCredit ?? 0;
    ctx.playNext[i] = p.playNext ? 1 : 0;
    ctx.strength[i] = req.strength?.[p.id] ?? 0.5;
  }
  const rounds = played(req.history);
  rounds.forEach((round, r) => {
    const last = r === rounds.length - 1;
    const onCourt = round.matches.reduce((s, m) => s + m.sideA.length + m.sideB.length, 0);
    const singlesSlots = round.matches.filter((m) => m.kind === 'singles').length * 2;
    const ratio = onCourt ? singlesSlots / onCourt : 0;
    for (const m of round.matches) {
      const sides = [m.sideA, m.sideB].map((s) => s.map((id) => index.get(id)).filter((i) => i !== undefined));
      for (const side of sides)
        for (const i of side) {
          ctx.eff[i] += 1;
          ctx.expected[i] += ratio;
          if (m.kind === 'singles') {
            ctx.singles[i] += 1;
            if (last) ctx.singlesLast[i] = 1;
          }
        }
      for (const side of sides)
        if (side.length === 2) {
          ctx.partner[side[0] * n + side[1]]++;
          ctx.partner[side[1] * n + side[0]]++;
        }
      for (const a of sides[0])
        for (const b of sides[1]) {
          ctx.opp[a * n + b]++;
          ctx.opp[b * n + a]++;
          if (m.kind === 'singles') {
            ctx.singlesOpp[a * n + b]++;
            ctx.singlesOpp[b * n + a]++;
          }
        }
    }
    // sittingOut only ever lists active players, so these are sit-outs over rounds present.
    for (const id of round.sittingOut) {
      const i = index.get(id);
      if (i === undefined) continue;
      ctx.sits[i] += 1;
      ctx.sitAgo[i] = rounds.length - r;
      if (last) ctx.satOutLast[i] = 1;
    }
  });
  ctx.effMax = n ? Math.max(...ctx.eff) : 0;
  ctx.minSingles = n ? Math.min(...ctx.singles) : 0;
  return ctx;
}

function layoutFrom(plan: { courtId: Id; kind: CourtKind }[]): Layout {
  const offsets: number[] = [];
  let playing = 0;
  let singlesSlots = 0;
  for (const c of plan) {
    offsets.push(playing);
    const size = c.kind === 'doubles' ? 4 : 2;
    playing += size;
    if (c.kind === 'singles') singlesSlots += 2;
  }
  return { plan, offsets, playing, singlesRatio: playing ? singlesSlots / playing : 0 };
}

function benchFor(ctx: Context, benchSize: number): Bench {
  const mustSit = new Uint8Array(ctx.n);
  const swappable = new Uint8Array(ctx.n);
  if (benchSize > 0) {
    const threshold = [...ctx.sits].sort((a, b) => a - b)[benchSize - 1];
    for (let i = 0; i < ctx.n; i++) {
      if (ctx.sits[i] < threshold) mustSit[i] = 1;
      else if (ctx.sits[i] === threshold) swappable[i] = 1;
    }
  }
  return { mustSit, swappable };
}

function sitCost(ctx: Context, i: number): number {
  let c = (1 + ctx.effMax - ctx.eff[i]) ** 2;
  if (ctx.satOutLast[i]) c += Q;
  if (ctx.playNext[i]) c += Q;
  if (ctx.sitAgo[i] > 0) c += 0.1 / ctx.sitAgo[i];
  return c;
}

/** Cost of an assignment: slots[0..playing) fill the courts in order, the rest sit out. */
function evaluate(ctx: Context, layout: Layout, slots: Int32Array, breakdown?: Breakdown, violations?: Violations): number {
  const { n, weights } = ctx;
  let games = 0;
  let share = 0;
  let consec = 0;
  let partner = 0;
  let opp = 0;
  let skill = 0;
  let repeatTeams = 0;
  let repeatSingles = 0;
  let singlesAhead = 0;
  for (let s = layout.playing; s < slots.length; s++) games += sitCost(ctx, slots[s]);
  for (let k = 0; k < layout.plan.length; k++) {
    const o = layout.offsets[k];
    const isSingles = layout.plan[k].kind === 'singles';
    const half = isSingles ? 1 : 2;
    for (let s = o; s < o + 2 * half; s++) {
      const i = slots[s];
      const sPrime = ctx.singles[i] + (isSingles ? 1 : 0);
      const ePrime = ctx.expected[i] + layout.singlesRatio;
      share += (sPrime - ePrime) ** 2;
      if (isSingles) {
        if (ctx.singlesLast[i]) consec += 1;
        singlesAhead += ctx.singles[i] - ctx.minSingles;
      }
    }
    if (isSingles) {
      repeatSingles += ctx.singlesOpp[slots[o] * n + slots[o + 1]];
    } else {
      const p1 = ctx.partner[slots[o] * n + slots[o + 1]];
      const p2 = ctx.partner[slots[o + 2] * n + slots[o + 3]];
      partner += 2 * (p1 + p2);
      repeatTeams += p1 + p2;
    }
    let strA = 0;
    let strB = 0;
    for (let a = o; a < o + half; a++) {
      strA += ctx.strength[slots[a]];
      for (let b = o + half; b < o + 2 * half; b++) opp += 2 * ctx.opp[slots[a] * n + slots[b]];
    }
    for (let b = o + half; b < o + 2 * half; b++) strB += ctx.strength[slots[b]];
    skill += (Math.abs(strA - strB) / half) * 10;
  }
  if (breakdown) {
    breakdown.equalGames = games;
    breakdown.singlesShare = share;
    breakdown.noConsecutiveSingles = consec;
    breakdown.partnerVariety = partner;
    breakdown.opponentVariety = opp;
    breakdown.skillBalance = weights.skillBalance ? skill : 0;
  }
  if (violations) Object.assign(violations, { repeatTeams, repeatSingles, singlesAhead });
  return (
    HARD * (repeatTeams + repeatSingles + singlesAhead) +
    weights.equalGames * games +
    weights.singlesShare * share +
    weights.noConsecutiveSingles * consec +
    weights.partnerVariety * partner +
    weights.opponentVariety * opp +
    weights.skillBalance * skill
  );
}

function initial(ctx: Context, layout: Layout, bench: Bench, rand: () => number): Int32Array {
  const size = ctx.n - layout.playing;
  const all = Array.from({ length: ctx.n }, (_, i) => i);
  const forced = all.filter((i) => bench.mustSit[i]);
  const choices = all
    .filter((i) => bench.swappable[i])
    .map((i) => ({ i, c: sitCost(ctx, i) + rand() * 0.5 }))
    .sort((x, y) => x.c - y.c)
    .map((x) => x.i);
  const sitters = [...forced, ...choices.slice(0, size - forced.length)];
  const sitting = new Set(sitters);
  const players = shuffle(all.filter((i) => !sitting.has(i)), rand);
  return Int32Array.from([...players, ...sitters]);
}

/** A swap between court and bench is only allowed between two interchangeable players. */
function allowed(layout: Layout, bench: Bench, slots: Int32Array, i: number, j: number): boolean {
  if (i < layout.playing === j < layout.playing) return true;
  return bench.swappable[slots[i]] === 1 && bench.swappable[slots[j]] === 1;
}

function anneal(ctx: Context, layout: Layout, bench: Bench, slots: Int32Array, rand: () => number): number {
  const n = slots.length;
  let cost = evaluate(ctx, layout, slots);
  let best = cost;
  const bestSlots = Int32Array.from(slots);
  const t0 = ctx.weights.singlesShare * 0.5 + 1;
  const t1 = 0.01;
  for (let step = 0; step < STEPS; step++) {
    const t = t0 * (t1 / t0) ** (step / STEPS);
    const i = Math.floor(rand() * n);
    const j = Math.floor(rand() * n);
    if (i === j || (i >= layout.playing && j >= layout.playing) || !allowed(layout, bench, slots, i, j)) continue;
    [slots[i], slots[j]] = [slots[j], slots[i]];
    const next = evaluate(ctx, layout, slots);
    const delta = next - cost;
    if (delta <= 0 || rand() < Math.exp(-delta / t)) {
      cost = next;
      if (cost < best) {
        best = cost;
        bestSlots.set(slots);
      }
    } else {
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
  }
  slots.set(bestSlots);
  return best;
}

function hillClimb(ctx: Context, layout: Layout, bench: Bench, slots: Int32Array): number {
  let cost = evaluate(ctx, layout, slots);
  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < layout.playing; i++)
      for (let j = i + 1; j < slots.length; j++) {
        if (!allowed(layout, bench, slots, i, j)) continue;
        [slots[i], slots[j]] = [slots[j], slots[i]];
        const next = evaluate(ctx, layout, slots);
        if (next < cost - 1e-9) {
          cost = next;
          improved = true;
        } else {
          [slots[i], slots[j]] = [slots[j], slots[i]];
        }
      }
  }
  return cost;
}

function toProposal(ctx: Context, layout: Layout, slots: Int32Array, downgraded: Id[]): Proposal {
  const breakdown = {} as Breakdown;
  const violations = {} as Violations;
  const cost = evaluate(ctx, layout, slots, breakdown, violations);
  const matches = layout.plan.map((c, k) => {
    const o = layout.offsets[k];
    const half = c.kind === 'doubles' ? 2 : 1;
    const ids = (from: number) => Array.from(slots.slice(from, from + half), (i) => ctx.ids[i]);
    return { courtId: c.courtId, kind: c.kind, sideA: ids(o), sideB: ids(o + half) };
  });
  const benchSet = new Set(Array.from(slots.slice(layout.playing)));
  const sittingOut = ctx.ids.filter((_, i) => benchSet.has(i));
  return { matches, sittingOut, downgraded, cost, breakdown, violations };
}

export function generateRound(req: ScheduleRequest): Proposal {
  const ctx = buildContext(req);
  const plans: CourtPlan[] = planLayout(ctx.n, req.courts, req.settings.fillOrder, req.settings.shortDoubles);
  const layout = layoutFrom(plans);
  const bench = benchFor(ctx, ctx.n - layout.playing);
  const downgraded = plans.filter((p) => p.downgraded).map((p) => p.courtId);
  const rand = rng(req.seed);
  if (layout.playing === 0) return toProposal(ctx, layout, initial(ctx, layout, bench, rand), downgraded);

  let best: Int32Array | null = null;
  let bestCost = Infinity;
  for (let r = 0; r < RESTARTS; r++) {
    const slots = initial(ctx, layout, bench, rand);
    const cost = anneal(ctx, layout, bench, slots, rand);
    if (cost < bestCost) {
      bestCost = cost;
      best = slots;
    }
  }
  hillClimb(ctx, layout, bench, best!);
  return toProposal(ctx, layout, best!, downgraded);
}

/** Scores an arbitrary (e.g. manually edited) round with the same cost function. */
export function evaluateRound(
  req: Omit<ScheduleRequest, 'seed'>,
  round: { matches: ProposedMatch[]; sittingOut: Id[] },
): { cost: number; breakdown: Breakdown; violations: Violations } {
  const ctx = buildContext({ ...req, seed: 0 });
  const index = new Map(ctx.ids.map((id, i) => [id, i]));
  const layout = layoutFrom(round.matches);
  const ids = [...round.matches.flatMap((m) => [...m.sideA, ...m.sideB]), ...round.sittingOut];
  const slots = Int32Array.from(ids.map((id) => index.get(id) ?? -1).filter((i) => i >= 0));
  const breakdown = {} as Breakdown;
  const violations = {} as Violations;
  if (slots.length < layout.playing) return { cost: Infinity, breakdown, violations };
  return { cost: evaluate(ctx, layout, slots, breakdown, violations), breakdown, violations };
}

/** Per-player reasons a round is less than ideal, for preview warnings (e.g. after manual swaps). */
export function roundWarnings(
  req: Omit<ScheduleRequest, 'seed'>,
  round: { matches: ProposedMatch[]; sittingOut: Id[] },
): { playerId: Id; reason: string }[] {
  const ctx = buildContext({ ...req, seed: 0 });
  const index = new Map(ctx.ids.map((id, i) => [id, i]));
  const out: { playerId: Id; reason: string }[] = [];
  const onCourt = round.matches.flatMap((m) => [...m.sideA, ...m.sideB]);
  const benchSet = new Set(round.sittingOut);
  // Sit-outs after this round; flag sitters who would end up 2+ ahead of someone present.
  const after = ctx.ids.map((id, i) => ctx.sits[i] + (benchSet.has(id) ? 1 : 0));
  const minAfter = after.length ? Math.min(...after) : 0;
  const minEffPlaying = Math.min(...onCourt.map((id) => ctx.eff[index.get(id) ?? 0]));
  for (const id of round.sittingOut) {
    const i = index.get(id);
    if (i === undefined) continue;
    if (after[i] - minAfter > 1) out.push({ playerId: id, reason: 'would sit out 2 more than someone else' });
    else if (ctx.satOutLast[i]) out.push({ playerId: id, reason: 'sat out last round too' });
    else if (ctx.playNext[i]) out.push({ playerId: id, reason: 'just arrived — should play' });
    else if (ctx.eff[i] < minEffPlaying) out.push({ playerId: id, reason: 'has played fewer games' });
  }
  for (const m of round.matches) {
    if (m.kind === 'singles') {
      const [a, b] = [index.get(m.sideA[0]), index.get(m.sideB[0])];
      for (const [id, i] of [
        [m.sideA[0], a],
        [m.sideB[0], b],
      ] as const) {
        if (i === undefined) continue;
        if (ctx.singlesLast[i]) out.push({ playerId: id, reason: 'singles two rounds running' });
        if (ctx.singles[i] > ctx.minSingles) out.push({ playerId: id, reason: "second singles while someone hasn't had one" });
      }
      if (a !== undefined && b !== undefined && ctx.singlesOpp[a * ctx.n + b] > 0) out.push({ playerId: m.sideA[0], reason: 'repeat singles match' });
    }
    for (const side of [m.sideA, m.sideB])
      if (side.length === 2) {
        const [a, b] = side.map((id) => index.get(id));
        if (a !== undefined && b !== undefined && ctx.partner[a * ctx.n + b] > 0) out.push({ playerId: side[0], reason: 'repeat partner' });
      }
  }
  return out;
}

/** (Re)activation credits: games up to the field's lowest (join at par); sit-outs up to the
 *  field's highest, so they're first to play while staying inside the one-sit-out spread. */
export function activationCredit(players: Player[], history: Round[], id: Id): { games: number; sits: number } {
  const appearances = new Map<Id, number>();
  const sitOuts = new Map<Id, number>();
  for (const r of played(history)) {
    for (const m of r.matches) for (const pid of [...m.sideA, ...m.sideB]) appearances.set(pid, (appearances.get(pid) ?? 0) + 1);
    for (const pid of r.sittingOut) sitOuts.set(pid, (sitOuts.get(pid) ?? 0) + 1);
  }
  const me = players.find((p) => p.id === id);
  if (!me) return { games: 0, sits: 0 };
  const others = players.filter((p) => p.active && p.id !== id);
  if (!others.length) return { games: me.gamesCredit, sits: me.sitCredit ?? 0 };
  const games = Math.min(...others.map((p) => (appearances.get(p.id) ?? 0) + p.gamesCredit));
  const sits = Math.max(...others.map((p) => (sitOuts.get(p.id) ?? 0) + (p.sitCredit ?? 0)));
  return {
    games: Math.max(me.gamesCredit, games - (appearances.get(id) ?? 0)),
    sits: Math.max(me.sitCredit ?? 0, sits - (sitOuts.get(id) ?? 0)),
  };
}
