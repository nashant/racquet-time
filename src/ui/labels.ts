import type { Priority, Tiebreaker } from '../domain/types';

export const TIEBREAKER_LABEL: Record<Tiebreaker, string> = {
  wins: 'Wins',
  winPct: 'Win %',
  pointsDiff: 'Points difference',
  avgPointsDiff: 'Average points difference',
  pointsFor: 'Points for',
  matchesPlayed: 'Matches played',
  headToHead: 'Head-to-head',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  equalGames: 'Equal games & fair sit-outs',
  singlesShare: 'Equal singles/doubles share',
  noConsecutiveSingles: 'No singles twice in a row',
  partnerVariety: 'Partner variety',
  opponentVariety: 'Opponent variety',
  skillBalance: 'Skill balance (if on)',
};

export function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function signed(x: number, digits = 0): string {
  const v = digits ? x.toFixed(digits) : String(Math.round(x));
  return x > 0 ? `+${v}` : v;
}

export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
}
