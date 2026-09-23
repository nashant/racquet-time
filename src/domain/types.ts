export type Id = string;

export type CourtKind = 'singles' | 'doubles';

export interface Player {
  id: Id;
  name: string;
  active: boolean;
  /** Games credited on (re)activation so late arrivals join "at par" with the field. */
  gamesCredit: number;
  /** Set when a player arrives late / returns; cleared once they are put on court. */
  playNext: boolean;
}

export interface Court {
  id: Id;
  name: string;
  kind: CourtKind;
}

export type RoundFormat =
  | { kind: 'timed'; minutes: number }
  | { kind: 'points'; target: number };

export type Metric =
  | 'wins'
  | 'winPct'
  | 'pointsDiff'
  | 'avgPointsDiff'
  | 'pointsFor'
  | 'matchesPlayed';

export type Tiebreaker = Metric | 'headToHead';

export type Priority =
  | 'equalGames'
  | 'singlesShare'
  | 'noConsecutiveSingles'
  | 'partnerVariety'
  | 'opponentVariety'
  | 'skillBalance';

export type PlayoffFormat =
  | { kind: 'points'; target: number; alternatingServe: boolean }
  | { kind: 'rally' };

export interface Settings {
  format: RoundFormat;
  allowDraws: boolean;
  tiebreakers: Tiebreaker[];
  priorities: Priority[];
  skillBalance: boolean;
  fillOrder: 'doublesFirst' | 'singlesFirst';
  shortDoubles: 'asSingles' | 'leaveEmpty';
  playoffFormat: PlayoffFormat;
  threePlayerPlayoff: 'roundRobin' | 'knockout';
}

export interface Score {
  a: number;
  b: number;
}

export interface Match {
  id: Id;
  courtId: Id;
  kind: CourtKind;
  sideA: Id[];
  sideB: Id[];
  /** null = not scored (flagged in the UI, excluded from stats). */
  score: Score | null;
}

export interface Timer {
  durationMs: number;
  /** Epoch ms when the timer was last started; null while paused. */
  runningSince: number | null;
  accumulatedMs: number;
  alerted: boolean;
}

export type RoundStatus = 'preview' | 'live' | 'done';

export interface Round {
  id: Id;
  status: RoundStatus;
  seed: number;
  matches: Match[];
  sittingOut: Id[];
  timer: Timer | null;
}

export type Source =
  | { seed: number }
  | { winnerOf: Id }
  | { loserOf: Id }
  | { bye: true };

export interface PlayoffMatch {
  id: Id;
  label: string;
  a: Source;
  b: Source;
  courtId: Id | null;
  score: Score | null;
  /** Points so far while the match is being played (saved so a reload never loses them). */
  progress?: Score | null;
}

export type PlayoffKind = 'single' | 'knockout' | 'knockout3' | 'roundRobin';

export interface Playoff {
  id: Id;
  /** Sorted member ids: the exact tie this playoff resolves. */
  members: Id[];
  startPosition: number;
  kind: PlayoffKind;
  seed: number;
  /** Draw order; `{ seed: n }` sources index into this array. */
  draw: Id[];
  status: 'draw' | 'live' | 'done';
  format: PlayoffFormat;
  matches: PlayoffMatch[];
  /** Knockout placements (phantom byes already removed); position i = placements[i]. */
  placements: Source[];
  /** Round-robin only: deciding sub-playoffs for players still level. */
  deciders: Playoff[];
  createdAt: number;
}

export interface Session {
  id: Id;
  name: string;
  date: string;
  players: Player[];
  courts: Court[];
  settings: Settings;
  rounds: Round[];
  playoffs: Playoff[];
}

export const SCHEMA_VERSION = 1;

export interface Prefs {
  theme: 'auto' | 'light' | 'dark';
  sound: boolean;
}

export interface Persisted {
  version: typeof SCHEMA_VERSION;
  session: Session | null;
  /** Previous session snapshots, most recent last. */
  undo: Session[];
  prefs: Prefs;
}

export const ALL_METRICS: Metric[] = [
  'wins',
  'winPct',
  'pointsDiff',
  'avgPointsDiff',
  'pointsFor',
  'matchesPlayed',
];

export const DEFAULT_PRIORITIES: Priority[] = [
  'equalGames',
  'singlesShare',
  'noConsecutiveSingles',
  'partnerVariety',
  'opponentVariety',
  'skillBalance',
];

export function defaultSettings(): Settings {
  return {
    format: { kind: 'timed', minutes: 12 },
    allowDraws: false,
    tiebreakers: ['winPct', 'avgPointsDiff', 'pointsFor', 'headToHead'],
    priorities: [...DEFAULT_PRIORITIES],
    skillBalance: false,
    fillOrder: 'doublesFirst',
    shortDoubles: 'asSingles',
    playoffFormat: { kind: 'points', target: 4, alternatingServe: true },
    threePlayerPlayoff: 'roundRobin',
  };
}
