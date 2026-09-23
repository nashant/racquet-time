// Draws the leaderboard as a PNG for sharing. Always the light palette, so it reads the same
// in any chat app regardless of the sharer's theme.
import { computeStandings } from '../domain/ranking';
import type { Session } from '../domain/types';

const C = {
  ground: '#eef3f0',
  surface: '#ffffff',
  ink: '#0c1813',
  ink2: '#3f5048',
  line: '#c3d1c9',
  court: '#17694a',
  courtInk: '#ffffff',
  ties: ['#ffe7a3', '#cfe6ff', '#ffd6e4', '#d9f3cf', '#e6dbff', '#ffe0c7'],
};
const DISPLAY = '"Barlow Condensed", "Arial Narrow", sans-serif';
const BODY = '"Atkinson Hyperlegible", system-ui, sans-serif';

const W = 1080;
const PAD = 56;
const HEADER = 250;
const HEAD_ROW = 70;
const ROW = 92;
const FOOTER = 120;

function when(s: Session): string {
  const d = new Date(`${s.date}T12:00:00`);
  return Number.isNaN(d.getTime()) ? s.date : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
}

function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

const signed = (n: number, digits = 0) => {
  const v = digits ? n.toFixed(digits) : String(Math.round(n));
  return n > 0 ? `+${v}` : v;
};

export async function leaderboardPng(s: Session): Promise<Blob> {
  await Promise.all(
    [`700 44px ${DISPLAY}`, `600 30px ${DISPLAY}`, `400 34px ${BODY}`, `700 34px ${BODY}`].map((f) => document.fonts.load(f).catch(() => [])),
  );
  const st = computeStandings(s.players, s.rounds, s.settings.tiebreakers, s.playoffs);
  const name = new Map(s.players.map((p) => [p.id, p.name]));
  const ranked = st.rows.filter((r) => r.position !== null);
  const unranked = st.rows.filter((r) => r.position === null).map((r) => name.get(r.playerId)!);
  const rounds = s.rounds.filter((r) => r.status === 'done').length;
  const tied = ranked.some((r) => r.tieGroup !== null);
  const H = HEADER + HEAD_ROW + ranked.length * ROW + (unranked.length ? 70 : 0) + FOOTER + (tied ? 40 : 0);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';

  ctx.fillStyle = C.ground;
  ctx.fillRect(0, 0, W, H);

  // Header band: session name, date, rounds played.
  ctx.fillStyle = C.court;
  ctx.fillRect(0, 0, W, HEADER);
  ctx.fillStyle = C.courtInk;
  ctx.font = `700 84px ${DISPLAY}`;
  ctx.fillText(fit(ctx, s.name.toUpperCase(), W - PAD * 2), PAD, 96);
  ctx.font = `400 34px ${BODY}`;
  ctx.fillText(`${when(s)} · after ${rounds} round${rounds === 1 ? '' : 's'}`, PAD, 176);

  // Columns: position, player, played, W–L, win %, points difference.
  const cols = { pos: PAD, name: PAD + 150, mp: 640, wl: 770, pct: 900, pd: W - PAD };
  let y = HEADER;
  ctx.fillStyle = C.surface;
  ctx.fillRect(0, y, W, HEAD_ROW + ranked.length * ROW);
  ctx.fillStyle = C.ink2;
  ctx.font = `600 30px ${DISPLAY}`;
  const head = (text: string, x: number, align: CanvasTextAlign) => {
    ctx.textAlign = align;
    ctx.fillText(text, x, y + HEAD_ROW / 2);
  };
  head('POS', cols.pos, 'left');
  head('PLAYER', cols.name, 'left');
  head('P', cols.mp, 'right');
  head('W–L', cols.wl, 'right');
  head('WIN %', cols.pct, 'right');
  head('PD', cols.pd, 'right');
  y += HEAD_ROW;

  for (const r of ranked) {
    if (r.tieGroup !== null) {
      ctx.fillStyle = C.ties[r.tieGroup % C.ties.length];
      ctx.fillRect(0, y, W, ROW);
    }
    ctx.fillStyle = C.line;
    ctx.fillRect(0, y, W, 2);
    const mid = y + ROW / 2;
    const x = r.stats;
    ctx.fillStyle = C.ink;
    ctx.textAlign = 'left';
    ctx.font = `700 46px ${DISPLAY}`;
    const pos = r.viaPlayoff ? r.label.replace(' (playoff)', '') : r.label;
    ctx.fillText(pos, cols.pos, r.viaPlayoff ? mid - 12 : mid);
    if (r.viaPlayoff) {
      ctx.font = `700 20px ${BODY}`;
      ctx.fillStyle = C.ink2;
      ctx.fillText('PLAYOFF', cols.pos, mid + 26);
      ctx.fillStyle = C.ink;
    }
    ctx.font = `700 38px ${BODY}`;
    ctx.fillText(fit(ctx, name.get(r.playerId)!, cols.mp - cols.name - 60), cols.name, mid);
    ctx.textAlign = 'right';
    ctx.font = `400 36px ${BODY}`;
    ctx.fillText(String(x.matchesPlayed), cols.mp, mid);
    ctx.fillText(`${x.wins}–${x.losses}${x.draws ? `–${x.draws}` : ''}`, cols.wl, mid);
    ctx.fillText(`${Math.round(x.winPct * 100)}%`, cols.pct, mid);
    ctx.font = `700 36px ${BODY}`;
    ctx.fillStyle = x.pointsDiff > 0 ? C.court : x.pointsDiff < 0 ? '#b4231b' : C.ink;
    ctx.fillText(signed(x.pointsDiff), cols.pd, mid);
    y += ROW;
  }

  ctx.textAlign = 'left';
  if (unranked.length) {
    ctx.fillStyle = C.ink2;
    ctx.font = `400 30px ${BODY}`;
    ctx.fillText(fit(ctx, `Not played yet: ${unranked.join(', ')}`, W - PAD * 2), PAD, y + 42);
    y += 70;
  }

  // Footer: ranking order, so the table explains itself.
  ctx.fillStyle = C.ink2;
  ctx.font = `400 26px ${BODY}`;
  const order = s.settings.tiebreakers
    .map((t) => ({ wins: 'wins', winPct: 'win %', pointsDiff: 'points diff', avgPointsDiff: 'avg points diff', pointsFor: 'points for', matchesPlayed: 'played', headToHead: 'head-to-head' })[t])
    .join(' → ');
  ctx.fillText(fit(ctx, `Ranked by ${order}`, W - PAD * 2), PAD, y + 44);
  if (tied) {
    y += 40;
    ctx.fillText('Shared colour and “=” mean players are still exactly level.', PAD, y + 44);
  }
  ctx.fillStyle = C.court;
  ctx.font = `700 28px ${DISPLAY}`;
  ctx.fillText('RACQUET TIME', PAD, y + 88);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create image'))), 'image/png'));
}
