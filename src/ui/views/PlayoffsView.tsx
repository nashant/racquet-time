import { useState } from 'preact/hooks';
import * as A from '../../domain/actions';
import { allMatches, playoffOrder, servingSide, sides } from '../../domain/playoffs';
import { ordinal, unresolvedTies } from '../../domain/ranking';
import { randomSeed } from '../../domain/rng';
import type { Id, Playoff, PlayoffMatch, Score, Source } from '../../domain/types';
import { ScorePad, Seg, Stepper } from '../components';
import { useCourtName, useNames, useSession, useStore } from '../context';
import { ConfirmButton, CourtCard } from './RoundView';
import { standingsOf } from './TableView';

export function PlayoffsView() {
  const s = useSession();
  const st = standingsOf(s);
  const open = unresolvedTies(st);
  const current = s.playoffs.filter((p) => !st.stale.has(p.id)).sort((a, b) => a.startPosition - b.startPosition);
  const stale = s.playoffs.filter((p) => st.stale.has(p.id));
  return (
    <>
      <div class="page-head">
        <h2>Playoffs</h2>
        <span class="eyebrow">Tie-breaks</span>
      </div>
      <p class="muted">Playoffs only put tied players in order. They never change wins, points or any other stat.</p>
      {stale.map((p) => (
        <StaleCard key={p.id} playoff={p} />
      ))}
      <OnCourt playoffs={current} />
      {open.length > 0 ? <ResolvePanel /> : !current.length && <p class="panel muted">No ties to resolve right now.</p>}
      {current.map((p) => (
        <PlayoffCard key={p.id} playoff={p} />
      ))}
    </>
  );
}

function ResolvePanel() {
  const store = useStore();
  const s = useSession();
  const name = useNames();
  const open = unresolvedTies(standingsOf(s));
  const [mode, setMode] = useState<'all' | 'top' | 'pick'>('all');
  const [topN, setTopN] = useState(3);
  const [picked, setPicked] = useState<Set<string>>(new Set(open.map((t) => t.key)));
  const chosen = open.filter((t) => (mode === 'all' ? true : mode === 'top' ? t.position <= topN : picked.has(t.key)));
  const f = s.settings.playoffFormat;
  const setFormat = (patch: Parameters<typeof A.updateSettings>[1]) => store.commit((x) => A.updateSettings(x, patch));

  return (
    <div class="panel">
      <h3>Resolve ties</h3>
      <Seg
        label="Which ties"
        value={mode}
        onChange={setMode}
        options={[
          ['all', 'All groups'],
          ['top', 'Top N'],
          ['pick', 'Choose'],
        ]}
      />
      {mode === 'top' && (
        <label class="field">
          <span>Groups touching the top…</span>
          <Stepper label="Top N positions" value={topN} min={1} onChange={setTopN} />
        </label>
      )}
      <ul class="list">
        {open.map((t) => (
          <li>
            <label class="check">
              <input
                type="checkbox"
                id={`tie-${t.key}`}
                checked={chosen.includes(t)}
                disabled={mode !== 'pick'}
                onChange={(e) => {
                  const next = new Set(picked);
                  if ((e.currentTarget as HTMLInputElement).checked) next.add(t.key);
                  else next.delete(t.key);
                  setPicked(next);
                }}
              />
              <span>
                <span class="score" style="font-size:22px">={ordinal(t.position)}</span> {t.members.map(name).join(', ')}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <span class="eyebrow">Format</span>
      <Seg
        label="Playoff scoring"
        value={f.kind}
        onChange={(kind) => setFormat({ playoffFormat: kind === 'rally' ? { kind: 'rally' } : { kind: 'points', target: 4, alternatingServe: true } })}
        options={[
          ['points', 'First to N'],
          ['rally', 'One deciding rally'],
        ]}
      />
      {f.kind === 'points' && (
        <>
          <label class="field">
            <span>First to (golden point)</span>
            <Stepper label="Points to win" value={f.target} min={1} onChange={(target) => setFormat({ playoffFormat: { ...f, target } })} />
          </label>
          <label class="check">
            <input
              type="checkbox"
              id="alternating-serve"
              checked={f.alternatingServe}
              onChange={(e) => setFormat({ playoffFormat: { ...f, alternatingServe: (e.currentTarget as HTMLInputElement).checked } })}
            />
            <span>Alternating serve</span>
          </label>
        </>
      )}
      {open.some((t) => t.members.length === 3) && (
        <label class="field">
          <span>3-player ties</span>
          <Seg
            label="3-player format"
            value={s.settings.threePlayerPlayoff}
            onChange={(v) => setFormat({ threePlayerPlayoff: v })}
            options={[
              ['roundRobin', 'Round robin'],
              ['knockout', 'Knockout'],
            ]}
          />
        </label>
      )}
      <button class="btn primary big block" disabled={!chosen.length} onClick={() => store.commit((x) => A.createPlayoffs(x, chosen, Date.now(), randomSeed()))}>
        Draw {chosen.length} playoff{chosen.length === 1 ? '' : 's'}
      </button>
    </div>
  );
}

function describe(p: Playoff, src: Source, name: (id: Id) => string): string {
  if ('seed' in src) return name(p.draw[src.seed]);
  if ('bye' in src) return 'Bye';
  const id = 'winnerOf' in src ? src.winnerOf : src.loserOf;
  const m = p.matches.find((x) => x.id === id);
  return `${'winnerOf' in src ? 'Winner' : 'Loser'} of ${m?.label ?? 'match'}`;
}

function OnCourt({ playoffs }: { playoffs: Playoff[] }) {
  const name = useNames();
  const courtName = useCourtName();
  const live = playoffs.filter((p) => p.status === 'live');
  const onCourt = live.flatMap((p) => allMatches(p).filter(({ match }) => match.courtId && !match.score).map((x) => ({ top: p, ...x })));
  const waiting = live.flatMap((p) =>
    allMatches(p)
      .filter(({ owner, match }) => !match.courtId && !match.score && sides(owner, match).every(Boolean))
      .map((x) => ({ top: p, ...x })),
  );
  if (!onCourt.length && !waiting.length) return null;
  return (
    <div class="section">
      <span class="eyebrow">On court now</span>
      {onCourt.map(({ top, owner, match }) => (
        <PlayoffScore key={match.id} top={top} owner={owner} match={match} title={courtName(match.courtId)} />
      ))}
      {waiting.length > 0 && (
        <p class="muted">
          Waiting for a free court: {waiting.map(({ owner, match }) => sides(owner, match).map((id) => name(id!)).join(' v ')).join('; ')}
        </p>
      )}
    </div>
  );
}

function PlayoffScore(props: { top: Playoff; owner: Playoff; match: PlayoffMatch; title: string; editing?: boolean; onDone?: () => void }) {
  const store = useStore();
  const name = useNames();
  const { top, owner, match } = props;
  const [a, b] = sides(owner, match) as [Id, Id];
  const f = owner.format;
  const [draft, setDraft] = useState<Score>(match.score ?? { a: 0, b: 0 });
  const finish = (score: Score) => {
    store.commit((x) => A.setPlayoffMatchScore(x, top.id, match.id, score));
    props.onDone?.();
  };

  if (f.kind === 'rally') {
    const winner = (id: Id, score: Score) => (
      <>
        <span class="name">{name(id)}</span>
        <button class="btn primary big block" style="margin-top:auto" onClick={() => finish(score)}>
          Won it
        </button>
      </>
    );
    return <CourtCard title={props.title} kind={`${match.label} · one rally`} a={winner(a, { a: 1, b: 0 })} b={winner(b, { a: 0, b: 1 })} />;
  }

  const score = props.editing ? draft : (match.progress ?? { a: 0, b: 0 });
  const update = (side: 'a' | 'b', f: (c: number | null) => number) => {
    if (props.editing) setDraft((d) => ({ ...d, [side]: f(d[side]) }));
    else store.commit((x) => A.adjustPlayoffProgress(x, top.id, match.id, side, f));
  };
  const leader = score.a > score.b ? a : score.b > score.a ? b : null;
  const reached = Math.max(score.a, score.b) >= f.target;
  const server = servingSide(score) === 'a' ? a : b;
  const half = (id: Id, side: 'a' | 'b') => (
    <>
      <span class="name">{name(id)}</span>
      <span class="serve" style={{ visibility: f.alternatingServe && server === id ? 'visible' : 'hidden' }}>
        ● Serving
      </span>
      <ScorePad label={`${name(id)} points`} value={score[side]} onChange={(f) => update(side, f)} />
    </>
  );
  const label = leader ? `${reached ? '' : 'End early — '}${name(leader)} wins ${Math.max(score.a, score.b)}–${Math.min(score.a, score.b)}` : 'Level — play on';
  return (
    <CourtCard
      title={props.title}
      kind={`${match.label} · first to ${f.target}`}
      a={half(a, 'a')}
      b={half(b, 'b')}
      foot={
        props.editing ? (
          <ConfirmButton class="btn primary block" label={leader ? `Save: ${name(leader)} wins` : 'Level — no winner'} confirmLabel="Tap again — later matches reset" disabled={!leader} onConfirm={() => finish(score)} />
        ) : (
          <button class="btn primary big block" disabled={!leader} onClick={() => finish(score)}>
            {label}
          </button>
        )
      }
    />
  );
}

function PlayoffCard({ playoff: p }: { playoff: Playoff }) {
  const store = useStore();
  const name = useNames();
  const courtName = useCourtName();
  const [editing, setEditing] = useState<Id | null>(null);
  const order = playoffOrder(p);
  const kindLabel = { single: 'One match', knockout: 'Knockout with placement matches', knockout3: 'Knockout', roundRobin: 'Round robin' }[p.kind];
  const formatLabel = p.format.kind === 'rally' ? 'one deciding rally' : `first to ${p.format.target}${p.format.alternatingServe ? ', alternating serve' : ''}`;
  const matches = allMatches(p);

  return (
    <div class="panel">
      <div class="row spread">
        <h3>Tie for ={ordinal(p.startPosition)}</h3>
        <span class={`flag${p.status === 'done' ? ' court' : ''}`}>{p.status === 'draw' ? 'Draw made' : p.status === 'live' ? 'In progress' : 'Settled'}</span>
      </div>
      <p class="small muted">
        {kindLabel} · {formatLabel}
      </p>
      {p.status === 'draw' && (
        <>
          <span class="eyebrow">Drawn by lot — they're level</span>
          <ol class="placings">
            {p.draw.map((id, i) => (
              <li>
                <b>Seed {i + 1}</b>
                {name(id)}
              </li>
            ))}
          </ol>
          <div class="row">
            <button class="btn" onClick={() => store.commit((x) => A.redrawPlayoff(x, p.id, randomSeed()))}>
              Re-draw
            </button>
            <button class="btn primary grow" onClick={() => store.commit((x) => A.startPlayoffs(x, [p.id]))}>
              Start playoff
            </button>
          </div>
        </>
      )}
      {order && (
        <>
          <span class="eyebrow">Final order</span>
          <ol class="placings">
            {order.map((id, i) => (
              <li>
                <b>{ordinal(p.startPosition + i)}</b>
                {name(id)}
              </li>
            ))}
          </ol>
        </>
      )}
      <ul class="list">
        {matches.map(({ owner, match }) => {
          const [a, b] = sides(owner, match);
          return (
            <li key={match.id}>
              <div class="row spread">
                <span>
                  <span class="eyebrow">
                    {match.label}
                    {owner !== p && ' · decider'}
                  </span>
                  <br />
                  {a ? name(a) : describe(owner, match.a, name)} v {b ? name(b) : describe(owner, match.b, name)}
                </span>
                <span class="row">
                  {match.score ? (
                    <>
                      <span class="score">
                        {match.score.a}–{match.score.b}
                      </span>
                      <button class="btn ghost" onClick={() => setEditing(editing === match.id ? null : match.id)} aria-expanded={editing === match.id}>
                        {editing === match.id ? 'Cancel' : 'Edit'}
                      </button>
                    </>
                  ) : match.courtId ? (
                    <span class="flag court">{courtName(match.courtId)}</span>
                  ) : (
                    <span class="muted small">{a && b ? 'Ready' : 'Waiting'}</span>
                  )}
                </span>
              </div>
              {editing === match.id && a && b && (
                <PlayoffScore top={p} owner={owner} match={match} title="Correct result" editing onDone={() => setEditing(null)} />
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmButton class="btn danger" label="Delete playoff" confirmLabel="Tap again — players go back to tied" onConfirm={() => store.commit((x) => A.deletePlayoff(x, p.id))} />
    </div>
  );
}

function StaleCard({ playoff: p }: { playoff: Playoff }) {
  const store = useStore();
  const name = useNames();
  return (
    <div class="banner" role="alert">
      <p>A score change means {p.members.map(name).join(', ')} are no longer tied as they were, so this playoff's result isn't used. Re-run it below if they're still level.</p>
      <button class="btn" onClick={() => store.commit((x) => A.deletePlayoff(x, p.id))}>
        Remove old playoff
      </button>
    </div>
  );
}
