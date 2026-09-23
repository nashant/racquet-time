import { useState } from 'preact/hooks';
import { computeStandings, ordinal, unresolvedTies, type Standings } from '../../domain/ranking';
import type { Session } from '../../domain/types';
import { go, useNames, useSession } from '../context';
import { pct, signed, TIEBREAKER_LABEL } from '../labels';
import { downloadBlob } from '../components';
import { leaderboardPng } from '../leaderboardImage';
import { slug } from '../labels';

export function standingsOf(s: Session): Standings {
  return computeStandings(s.players, s.rounds, s.settings.tiebreakers, s.playoffs);
}

export function StaleBanner() {
  const s = useSession();
  const name = useNames();
  const st = standingsOf(s);
  const stale = s.playoffs.filter((p) => st.stale.has(p.id));
  if (!stale.length) return null;
  return (
    <div class="banner" role="alert">
      {stale.map((p) => (
        <p>
          Scores changed since the playoff for {p.members.map(name).join(', ')} — its result no longer applies.
        </p>
      ))}
      <a href="#/playoffs">Re-run or remove it in Playoffs</a>
    </div>
  );
}

export function TableView() {
  const s = useSession();
  const name = useNames();
  const st = standingsOf(s);
  const open = unresolvedTies(st);
  const inPlay = st.ties.filter((t) => t.inProgress).length;
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [ready, setReady] = useState<File | null>(null);

  // Opens the device's own share sheet with a PNG of the table; downloads it where sharing files
  // isn't supported. If drawing took too long for the browser to allow sharing, keep the image so
  // a second tap shares it instantly.
  const share = async () => {
    setShareStatus(null);
    try {
      const file = ready ?? new File([await leaderboardPng(s)], `${slug(s.name)}-leaderboard.png`, { type: 'image/png' });
      if (!navigator.canShare?.({ files: [file] })) {
        downloadBlob(file.name, file);
        setShareStatus('This browser can’t share images, so it was downloaded instead.');
        return;
      }
      try {
        await navigator.share({ files: [file], title: `${s.name} leaderboard` });
        setReady(null);
      } catch (e) {
        const err = (e as DOMException).name;
        if (err === 'NotAllowedError') {
          setReady(file);
          setShareStatus('Image ready — tap Share again.');
        } else if (err !== 'AbortError') setShareStatus('Sharing didn’t work on this device. Try again.');
      }
    } catch {
      setShareStatus('Couldn’t create the image. Try again.');
    }
  };
  return (
    <>
      <div class="page-head">
        <h2>Leaderboard</h2>
        <button class="btn" onClick={share} disabled={!st.rows.some((r) => r.position !== null)}>
          Share
        </button>
      </div>
      {shareStatus && (
        <p class="small muted" role="status">
          {shareStatus}
        </p>
      )}
      <StaleBanner />
      {open.length > 0 && (
        <div class="panel row spread" style="flex-direction:row">
          <span>
            <strong>{open.length}</strong> group{open.length > 1 ? 's' : ''} still level
          </span>
          <button class="btn primary" onClick={() => go('#/playoffs')}>
            Resolve ties
          </button>
        </div>
      )}
      {inPlay > 0 && <p class="muted">Playoff in progress for {inPlay} group{inPlay > 1 ? 's' : ''}.</p>}
      {st.rows.length === 0 ? (
        <p class="muted">No players yet.</p>
      ) : (
        <div class="table-wrap">
          <table class="board">
            <thead>
              <tr>
                <th scope="col" class="pos">Pos</th>
                <th scope="col" class="who">Player</th>
                <th scope="col" title="Matches played">MP</th>
                <th scope="col" title="Singles / doubles">S/D</th>
                <th scope="col">W</th>
                <th scope="col">Win%</th>
                <th scope="col" title="Points for">PF</th>
                <th scope="col" title="Points against">PA</th>
                <th scope="col" title="Points difference">PD</th>
                <th scope="col" title="Average points difference per match">Avg</th>
              </tr>
            </thead>
            <tbody>
              {st.rows.map((r) => {
                const x = r.stats;
                const tie = r.tieGroup !== null ? `tie-${r.tieGroup % 6}` : '';
                const player = s.players.find((p) => p.id === r.playerId)!;
                return (
                  <tr key={r.playerId} class={tie} onClick={() => go(`#/player/${r.playerId}`)}>
                    <td class="pos">
                      {r.viaPlayoff ? r.label.replace(' (playoff)', '') : r.label}
                      {r.viaPlayoff && <small>playoff</small>}
                    </td>
                    <th scope="row" class="who">
                      <a href={`#/player/${r.playerId}`}>
                        {name(r.playerId)}
                      </a>
                      {!player.active && <span class="small muted"> (out)</span>}
                    </th>
                    <td>{x.matchesPlayed}</td>
                    <td>
                      {x.singles}/{x.doubles}
                    </td>
                    <td>{x.wins}</td>
                    <td>{x.matchesPlayed ? pct(x.winPct) : '–'}</td>
                    <td>{x.pointsFor}</td>
                    <td>{x.pointsAgainst}</td>
                    <td>{signed(x.pointsDiff)}</td>
                    <td>{x.matchesPlayed ? signed(x.avgPointsDiff, 1) : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p class="small muted">
        Ranked by {s.settings.tiebreakers.map((t) => TIEBREAKER_LABEL[t]).join(' → ')}. Shared colours and “=” mark players still exactly level.{' '}
        <a href="#/setup">Change</a>
      </p>
      {st.ties.length > 0 && (
        <p class="small muted">
          Ties: {st.ties.map((t) => `${t.resolvedBy ? '' : '='}${ordinal(t.position)} (${t.members.map(name).join(', ')})${t.resolvedBy ? ' — settled by playoff' : ''}`).join('; ')}
        </p>
      )}
    </>
  );
}
