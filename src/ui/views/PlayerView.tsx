import { allMatches, sides } from '../../domain/playoffs';
import { playerMatches } from '../../domain/stats';
import type { Id } from '../../domain/types';
import { useCourtName, useNames, useSession } from '../context';
import { pct, signed } from '../labels';
import { standingsOf } from './TableView';

export function PlayerView({ id }: { id: Id }) {
  const s = useSession();
  const name = useNames();
  const courtName = useCourtName();
  const player = s.players.find((p) => p.id === id);
  if (!player) return <p>Player not found.</p>;
  const row = standingsOf(s).rows.find((r) => r.playerId === id)!;
  const x = row.stats;
  const matches = playerMatches(id, s.rounds);
  const playoffMatches = s.playoffs.flatMap((p) =>
    allMatches(p)
      .map(({ owner, match }) => ({ match, ids: sides(owner, match) }))
      .filter(({ ids }) => ids.includes(id)),
  );

  return (
    <>
      <a href="#/table">← Leaderboard</a>
      <div class="section" style="gap:4px">
        <span class="eyebrow">{row.label}</span>
        <h2 class="hero-name">{player.name}</h2>
      </div>
      <div class="panel">
        <p>
          {x.matchesPlayed} played ({x.singles} singles, {x.doubles} doubles) · {x.wins}W {x.draws ? `${x.draws}D ` : ''}
          {x.losses}L · {x.matchesPlayed ? pct(x.winPct) : '–'}
        </p>
        <p>
          Points {x.pointsFor}–{x.pointsAgainst} ({signed(x.pointsDiff)}, avg {x.matchesPlayed ? signed(x.avgPointsDiff, 1) : '–'})
        </p>
        {!player.active && <p class="flag">Not playing (inactive)</p>}
      </div>
      <h3>Matches</h3>
      {matches.length === 0 && <p class="muted">No matches yet.</p>}
      <ul class="list panel">
        {matches.map(({ roundIndex, match, side, outcome }) => {
          const mine = side === 'A' ? match.sideA : match.sideB;
          const theirs = side === 'A' ? match.sideB : match.sideA;
          const partner = mine.filter((p) => p !== id);
          const score = match.score ? (side === 'A' ? `${match.score.a}–${match.score.b}` : `${match.score.b}–${match.score.a}`) : null;
          return (
            <li>
              <div class="row spread">
                <strong>
                  Round {roundIndex + 1} · {courtName(match.courtId)}
                </strong>
                <span class={outcome === 'win' ? 'win' : outcome === 'loss' ? 'loss' : ''}>
                  {outcome === 'unscored' ? <span class="flag">Not scored</span> : <><span class="score">{score}</span> {outcome.toUpperCase()}</>}
                </span>
              </div>
              <div class="small">
                {match.kind === 'doubles' ? `With ${partner.map(name).join(', ')} v ` : 'Singles v '}
                {theirs.map(name).join(' & ')}
              </div>
            </li>
          );
        })}
      </ul>
      {playoffMatches.length > 0 && (
        <>
          <h3>Playoff matches</h3>
          <p class="small muted">Playoffs only settle ties — they don't count towards the stats above.</p>
          <ul class="list panel">
            {playoffMatches.map(({ match, ids }) => (
              <li>
                <strong>{match.label}</strong> v {name(ids[0] === id ? ids[1]! : ids[0]!)}{' '}
                {match.score ? (ids[0] === id ? `${match.score.a}–${match.score.b}` : `${match.score.b}–${match.score.a}`) : <span class="muted">to play</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
