import { useState } from 'preact/hooks';
import * as A from '../../domain/actions';
import type { Id, Round } from '../../domain/types';
import { useCourtName, useNames, useSession, useStore } from '../context';
import { ConfirmButton, ScoreEntry } from './RoundView';

export function HistoryView() {
  const s = useSession();
  const rounds = s.rounds.filter((r) => r.status !== 'preview');
  return (
    <>
      <div class="page-head">
        <h2>History</h2>
        <span class="eyebrow">{rounds.length} round{rounds.length === 1 ? '' : 's'}</span>
      </div>
      {!rounds.length && <p class="muted">No rounds played yet.</p>}
      {rounds
        .map((r, i) => ({ r, n: i + 1 }))
        .reverse()
        .map(({ r, n }) => (
          <RoundCard key={r.id} round={r} number={n} />
        ))}
    </>
  );
}

function RoundCard({ round, number }: { round: Round; number: number }) {
  const store = useStore();
  const s = useSession();
  const name = useNames();
  const courtName = useCourtName();
  const [editing, setEditing] = useState<Id | null>(null);
  const unscored = round.matches.filter((m) => !m.score).length;
  return (
    <div class="panel">
      <div class="row spread">
        <h3>
          Round {number} {round.status === 'live' && <span class="flag">In play</span>}
        </h3>
        {unscored > 0 && <span class="flag">{unscored} unscored</span>}
      </div>
      <ul class="list">
        {round.matches.map((m) => (
          <li key={m.id}>
            <div class="row spread">
              <span>
                <span class="eyebrow">
                  {courtName(m.courtId)} · {m.kind}
                </span>
                <br />
                <strong>{m.sideA.map(name).join(' & ')}</strong> v <strong>{m.sideB.map(name).join(' & ')}</strong>
              </span>
              <span class="row">
                {m.score ? (
                  <span class="score">
                    {m.score.a}–{m.score.b}
                  </span>
                ) : (
                  <span class="flag">Not scored</span>
                )}
                <button class="btn ghost" onClick={() => setEditing(editing === m.id ? null : m.id)} aria-expanded={editing === m.id}>
                  {editing === m.id ? 'Done' : 'Edit'}
                </button>
              </span>
            </div>
            {editing === m.id && (
              <>
                <ScoreEntry roundId={round.id} match={m} labelA={`${m.sideA.map(name).join(' & ')} score`} labelB={`${m.sideB.map(name).join(' & ')} score`} />
                {m.score && (
                  <button class="btn link small" style="align-self:flex-end" onClick={() => store.commit((x) => A.setMatchScore(x, round.id, m.id, null))}>
                    Clear score
                  </button>
                )}
                {m.score && A.scoreProblem(m.score, s.settings.allowDraws) && <p class="flag">{A.scoreProblem(m.score, s.settings.allowDraws)}</p>}
              </>
            )}
          </li>
        ))}
      </ul>
      {round.sittingOut.length > 0 && <p class="small muted">Sat out: {round.sittingOut.map(name).join(', ')}</p>}
      {round.status === 'done' && (
        <ConfirmButton class="btn danger" label="Delete round" confirmLabel={`Tap again to delete round ${number}`} onConfirm={() => store.commit((x) => A.deleteRound(x, round.id))} />
      )}
    </div>
  );
}
