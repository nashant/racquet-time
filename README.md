# Racquet Time

A phone-first web app for running social badminton sessions: rotating players across a mix of singles and doubles courts, a shared round timer, a live leaderboard, and tie-break playoffs. It is a static site with no backend or accounts. Everything is saved on the device, and it works offline once loaded.

Live at **https://scoring.shedbuilt.link**.

## Local development

Requires Node 22+.

```sh
npm install
npm run dev        # Vite dev server
npm test           # Vitest (scheduler, ranking, playoffs, persistence, actions)
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ (service worker active)
```

The service worker is only registered in production builds, so use `npm run build && npm run preview` to test offline behaviour.

## Deploy

Every push to `main` runs `.github/workflows/deploy.yml`: `npm ci`, the tests, the build, then deploys `dist/` to GitHub Pages.

One-time repository setup:

1. **Settings → Pages → Source: GitHub Actions**.
2. **Settings → Pages → Custom domain: `scoring.shedbuilt.link`**, then tick **Enforce HTTPS** once the certificate is issued. (`public/CNAME` records the domain too.)
3. DNS: a `CNAME` record `scoring.shedbuilt.link → <github-user>.github.io` in the `shedbuilt.link` Route 53 zone.

Because the site is served from the domain root, Vite's `base` is `/` (`vite.config.ts`). If it's ever served as a project site instead (`<user>.github.io/racquet-time/`), set `base: '/racquet-time/'` and change the absolute paths in `index.html` and `src/main.tsx`.

## Project layout

```
src/domain/     pure logic, no DOM — everything here is unit-tested
  types.ts        state shape (Session, Round, Match, Playoff, …)
  layout.ts       which courts run, and as what, for N players
  scheduler.ts    round generator (cost function + search)
  stats.ts        per-player statistics from match history
  ranking.ts      tiebreakers, tie detection, playoff overlay, staleness
  playoffs.ts     brackets, progression, court assignment
  actions.ts      pure Session → Session transitions
src/state/      persistence: store (undo), localStorage, migrations, validation, import/export
src/ui/         Preact views and components
src/sw.js       service worker template (the build injects the precache list)
test/           Vitest suites
```

## Data and safety

- All state lives in `localStorage` under one key, `badminton:v1`, and is saved **synchronously after every change**. On load the app resumes exactly where it was: a running timer (stored as wall-clock start + accumulated time), an unfinished round, a playoff in progress (including points scored so far in a playoff match).
- The saved object carries a `version`. `src/state/migrations.ts` holds one migration per version step. A pre-migration copy is kept under `badminton:v1:pre-v<N>`.
- Data that can't be read (corrupt, or saved by a newer version) is never overwritten. It is copied to `badminton:v1:rescue`, a warning is shown, and it can be downloaded from **Setup → Recovery** and re-imported.
- Undo keeps the last 30 changes and survives reloads. If storage runs short, undo history is trimmed before a save is ever dropped.
- **Setup → Backup** exports the session as JSON and imports it on another phone.
- Rankings are never stored. They are recomputed from match history on every render.

## How the rotation works

Each round is a fixed set of **slots**: court → side → position, plus a bench. `layout.ts` decides the slots first. Courts are filled in the chosen order (doubles first by default). A doubles court that can't get four players runs as singles, or is left empty (configurable).

The scheduler (`src/domain/scheduler.ts`) then assigns active players to slots under three kinds of rule.

**Hard rule: sit-outs stay within 1.** Most minus least sit-outs among the players present never exceeds 1. Only rounds a player was present for count. If k players must sit out, anyone below the k-th lowest sit-out count must sit, anyone above it must play, and only players exactly at that count can be swapped with each other. The search never considers any other bench. A manual swap in the preview can still break this; the preview then warns.

**Near-hard rules.** Each break costs 10⁹, far more than all the priorities below combined, so a rule is only broken when every legal round breaks it:
- no doubles team plays together twice
- no singles match is repeated (singles meetings are counted separately from doubles opponents)
- nobody plays a second singles while someone present hasn't had one (the cost is how many singles they're ahead)

These can conflict in bigger groups. For 7 players on 1 doubles + 1 singles court over 6 rounds, every rule holds (tested). With 8–13 players, keeping "singles for everyone first" can occasionally force a repeat that would otherwise be avoidable. Some repeats are mathematically unavoidable, e.g. 11 players on 2 doubles courts for 15 rounds needs 60 teams but only 55 pairs exist.

**Weighted priorities** then pick between the rounds that remain:

| Priority (default order) | Cost for a candidate round |
|---|---|
| Equal games, fair sit-outs | For each player sitting out: `(1 + maxGames − theirGames)²`, **+50** if they also sat out last round, **+50** if they're a late arrival flagged to play next, plus a tiny nudge towards whoever sat out longest ago |
| Equal singles/doubles share | For each player on court: `(singlesPlayed − expectedSingles)²` after this round, where expected singles accumulates each round's share of singles places |
| No singles twice in a row | 1 per singles player who played singles last round |
| Partner variety | `2 × timesPartneredBefore` for each doubles pair |
| Opponent variety | `2 × timesOpposedBefore` for each pair of opponents (singles and doubles) |
| Skill balance (off by default) | `|teamA − teamB| × 10` using win rate with a +1/+2 prior |

Weights come from the priority order (reorderable under **Setup → Advanced**): the i-th of six priorities gets `6^(5−i)`, so higher priorities dominate almost lexicographically.

**Search:** 24 random restarts. Each restart fills the bench as the sit-out rule requires, picking among interchangeable players by lowest sit-out cost with random tie-breaks, shuffles everyone else onto court, and runs 1,500 steps of simulated annealing. Each step swaps two slots, which covers moves between courts, between teammates and opponents, and between singles and doubles. A swap with the bench is allowed only between two interchangeable players. The best result then gets an exhaustive pairwise-swap hill-climb. All randomness comes from a seeded PRNG, so the same seed and history always give the same round. The iteration budget is fixed rather than time-based, to keep that determinism. A 30-player, 8-court round takes about 20 ms, and the tests assert it stays under 200 ms. The near-hard rules are checked round by round, so a session can't be planned ahead; in exhaustive checks on 8–10 players, every round the scheduler produced had the fewest rule-breaks possible given the rounds before it.

**Late arrivals and withdrawals:** a player added or re-activated mid-session is credited with the lowest games count among active players, so they join level instead of playing every round to catch up. Their sit-outs are credited up to the highest count among active players, so they're first in line to play without breaking the within-1 rule. They are also flagged to play next. A player who withdraws mid-round (tap their name) keeps their current score, and later rounds are planned without them.

## How tie-break playoffs work

After the configured tiebreakers (default: win % → average points difference → points for → head-to-head), any players still **exactly** level form a tied group, shown as `=3rd` with a shared colour. **Resolve ties** creates a playoff for each selected group (all by default, or only groups touching the top N).

- **Seeding** is a random draw (they are level by definition). The draw is shown and can be re-drawn before starting.
- **2 players:** one match.
- **3 players:** round robin by default. Everyone plays twice, and players are ordered by wins, then playoff points difference. A three-way cycle that is still level goes to deciding rallies. A knockout option is also available: A v B, the winner plays C for 1st, the losers play for 2nd. That last match is skipped if C wins, because it would be a rematch whose result is already known.
- **4+ players:** a classification bracket. Each round's winners play on for the top half of the remaining places and the losers for the bottom half, so every position is decided (4 → 4 matches, 5 → 5, 8 → 12). The bracket is padded to a power of two with byes for the top seeds.
- **Format:** singles, default first to 4 with golden point and alternating serve (the app shows who serves), or a single deciding rally.
- **Scheduling:** ready matches (feeder matches done, players free) go onto free courts in parallel. Any court can host a playoff match.
- **Isolation:** playoff results are stored separately and never touch wins, points or any other statistic. They only reorder players inside their tied group, shown as e.g. `3rd` with a *playoff* tag.
- **Staleness:** a playoff applies only while its exact group still exists. If a later score edit changes or breaks the group, the playoff is marked stale, the tie is shown again, and the app asks you to re-run it. A stale result is never applied.

Playoffs are persisted, undoable, and included in JSON export/import.
