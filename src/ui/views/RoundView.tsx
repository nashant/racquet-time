import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as A from '../../domain/actions';
import { allMatches } from '../../domain/playoffs';
import { randomSeed } from '../../domain/rng';
import { rotationLength } from '../../domain/rotation';
import { roundWarnings } from '../../domain/scheduler';
import type { Id, Match, Round, Score, Session } from '../../domain/types';
import { beep, keepAwake, unlockAudio, vibrate } from '../alert';
import { ScorePad, Sheet } from '../components';
import { useCourtName, useNames, useNow, useSession, useStore } from '../context';
import { clock } from '../labels';

export function RoundView() {
  const s = useSession();
  const live = A.liveRound(s);
  const preview = A.preview(s);
  if (live) return <LiveRound round={live} />;
  if (preview) return <Preview round={preview} />;
  return <NextRound />;
}

const roundNumber = (s: Session) => s.rounds.filter((r) => r.status === 'done').length + 1;

function NextRound() {
  const store = useStore();
  const s = useSession();
  const active = s.players.filter((p) => p.active).length;
  const onCourtPlayoffs = s.playoffs.flatMap(allMatches).filter(({ match }) => match.courtId && !match.score).length;
  const places = s.courts.reduce((n, c) => n + (c.kind === 'doubles' ? 4 : 2), 0);
  const sitting = Math.max(0, active - places);
  return (
    <>
      <div class="page-head">
        <h2>Round {roundNumber(s)}</h2>
        <span class="eyebrow">Up next</span>
      </div>
      <div class="panel">
        <p style="font-size:20px">
          <strong>{active}</strong> playing · <strong>{s.courts.length}</strong> court{s.courts.length === 1 ? '' : 's'} · {places} places
          {sitting > 0 && (
            <>
              {' '}
              · <strong>{sitting}</strong> sit out
            </>
          )}
        </p>
        {active < 2 && <p class="banner">Add at least 2 players in Setup to plan a round.</p>}
        {!s.courts.length && <p class="banner">Add a court in Setup to plan a round.</p>}
        {onCourtPlayoffs > 0 && (
          <p class="banner">
            {onCourtPlayoffs} playoff match{onCourtPlayoffs > 1 ? 'es are' : ' is'} still on court. <a href="#/playoffs">Go to playoffs</a>
          </p>
        )}
        <button class="btn primary big block" disabled={active < 2 || !s.courts.length} onClick={() => store.commit((x) => A.generatePreview(x, randomSeed()))}>
          Plan round {roundNumber(s)}
        </button>
      </div>
    </>
  );
}

function kindLabel(s: Session, m: Match): string {
  const court = s.courts.find((c) => c.id === m.courtId);
  if (court?.kind === 'doubles' && m.kind === 'singles') return 'Singles · short court';
  return m.kind === 'doubles' ? 'Doubles' : 'Singles';
}

export function CourtCard(props: { title: string; kind: string; a: ComponentChildren; b: ComponentChildren; foot?: ComponentChildren }) {
  return (
    <section class="court">
      <header class="court-head">
        <h3>{props.title}</h3>
        <span class="court-kind">{props.kind}</span>
      </header>
      <div class="halves">
        <div class="half">{props.a}</div>
        <div class="half">{props.b}</div>
      </div>
      {props.foot && <div class="court-foot">{props.foot}</div>}
    </section>
  );
}

function Preview({ round }: { round: Round }) {
  const store = useStore();
  const s = useSession();
  const name = useNames();
  const courtName = useCourtName();
  const [selected, setSelected] = useState<Id | null>(null);
  const history = s.rounds.filter((r) => r.status !== 'preview');
  const warnings = roundWarnings({ players: s.players, courts: s.courts, history, settings: s.settings }, round);
  const unused = s.courts.filter((c) => !round.matches.some((m) => m.courtId === c.id));
  const rotation = round.rotation;
  const cycle = rotation ? rotationLength(s.players.filter((p) => p.active).length, s.courts) : null;

  const tap = (id: Id) => {
    if (selected === null) setSelected(id);
    else if (selected === id) setSelected(null);
    else {
      store.commit((x) => A.swapPlayers(x, selected, id));
      setSelected(null);
    }
  };

  const chip = (id: Id) => {
    const why = warnings.filter((w) => w.playerId === id).map((w) => w.reason);
    return (
      <button class={`chip${why.length ? ' warn' : ''}`} aria-pressed={selected === id} onClick={() => tap(id)}>
        <span>
          {name(id)}
          {why.length > 0 && <span class="why">{why.join(', ')}</span>}
        </span>
      </button>
    );
  };

  return (
    <>
      <div class="page-head">
        <h2>Round {roundNumber(s)}</h2>
        <span class="eyebrow">{rotation ? `Rotation · ${rotation.step + 1} of ${cycle}` : 'Preview'}</span>
      </div>
      {rotation && (
        <p class="muted small">
          {rotation.step === 0
            ? 'Everyone moves one place along each round, so no team or singles match repeats and everyone sits out once.'
            : 'Everyone has moved one place along from last round.'}
        </p>
      )}
      <p class="muted" aria-live="polite">
        {selected
          ? `Now tap who ${name(selected)} should swap with.`
          : rotation
            ? 'Tap two players to swap them. Swapping ends the rotation; later rounds are then planned to stay fair.'
            : 'Tap two players to swap them — including anyone sitting out.'}
      </p>
      {round.matches.map((m) => (
        <CourtCard key={m.id} title={courtName(m.courtId)} kind={kindLabel(s, m)} a={m.sideA.map(chip)} b={m.sideB.map(chip)} />
      ))}
      {unused.length > 0 && <p class="muted">Not used this round: {unused.map((c) => c.name).join(', ')}</p>}
      <div class="section">
        <span class="eyebrow">Sitting out · {round.sittingOut.length}</span>
        {round.sittingOut.length ? <div class="bench">{round.sittingOut.map(chip)}</div> : <p class="muted">Nobody — everyone's on court.</p>}
      </div>
      <button class="btn primary big block" onClick={() => store.commit(A.startRound)} disabled={!round.matches.length}>
        Start round
      </button>
      <div class="row">
        {rotation && rotation.step > 0 ? (
          <ConfirmButton
            class="btn grow"
            label="Plan without rotation"
            confirmLabel="Tap again — ends the rotation"
            onConfirm={() => store.commit((x) => A.generatePreview(x, randomSeed(), { rotation: false }))}
          />
        ) : (
          <button class="btn grow" onClick={() => store.commit((x) => A.generatePreview(x, randomSeed()))}>
            {rotation ? 'Re-draw order' : 'Regenerate'}
          </button>
        )}
        <button class="btn grow" onClick={() => store.commit(A.discardPreview)}>
          Discard
        </button>
      </div>
    </>
  );
}

function Timer({ round }: { round: Round }) {
  const store = useStore();
  const running = !!round.timer && round.timer.runningSince !== null;
  const now = useNow(running);
  const remaining = A.remainingMs(round, now);
  const done = remaining === 0;

  useEffect(() => {
    if (done && round.timer && !round.timer.alerted) {
      if (store.get().prefs.sound) beep();
      vibrate();
      store.commit(A.markAlerted, { undoable: false });
    }
  }, [done, round.timer?.alerted]);

  if (!round.timer) return null;
  const fraction = remaining / round.timer.durationMs;
  return (
    <div class={`timer${done ? ' done' : ''}`}>
      <div class="digits" role="timer" aria-label={done ? 'Time is up' : `${clock(remaining)} remaining`}>
        {done ? 'TIME' : clock(remaining)}
      </div>
      <div class="bar" aria-hidden="true">
        <i style={{ width: `${fraction * 100}%` }} />
      </div>
      <div class="row" style="justify-content:center">
        {running ? (
          <button class="btn big" onClick={() => store.commit((x) => A.pauseTimer(x, Date.now()), { undoable: false })}>
            Pause
          </button>
        ) : (
          <button
            class="btn primary big"
            disabled={done}
            onClick={() => {
              unlockAudio();
              store.commit((x) => A.startTimer(x, Date.now()), { undoable: false });
            }}
          >
            {round.timer.accumulatedMs ? 'Resume' : 'Start'}
          </button>
        )}
        <ConfirmButton class="btn big" label="Reset" confirmLabel="Reset timer?" onConfirm={() => store.commit(A.resetTimer, { undoable: false })} />
      </div>
    </div>
  );
}

/** Two-tap confirmation, so a stray tap courtside can't reset or delete anything. */
export function ConfirmButton(props: { class: string; label: string; confirmLabel: string; onConfirm: () => void; disabled?: boolean }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      class={`${props.class}${armed ? ' danger' : ''}`}
      disabled={props.disabled}
      onClick={() => {
        if (armed) {
          setArmed(false);
          props.onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? props.confirmLabel : props.label}
    </button>
  );
}

/** Score pads for both sides of a round match, for use outside a CourtCard (e.g. editing history). */
export function ScoreEntry(props: { roundId: Id; match: Match; labelA: string; labelB: string }) {
  const store = useStore();
  const { match } = props;
  const pad = (side: 'a' | 'b', label: string) => (
    <div class="half">
      <ScorePad
        label={label}
        value={match.score ? match.score[side] : null}
        onChange={(f) => store.commit((x) => A.adjustMatchScore(x, props.roundId, match.id, side, f))}
      />
    </div>
  );
  return (
    <div class="halves">
      {pad('a', props.labelA)}
      {pad('b', props.labelB)}
    </div>
  );
}

function LiveRound({ round }: { round: Round }) {
  const store = useStore();
  const s = useSession();
  const name = useNames();
  const courtName = useCourtName();
  const [withdrawing, setWithdrawing] = useState<Id | null>(null);
  const [ending, setEnding] = useState(false);
  const target = s.settings.format.kind === 'points' ? s.settings.format.target : null;
  const playoffCourts = new Set(
    s.playoffs.flatMap(allMatches).filter(({ match }) => match.courtId && !match.score).map(({ match }) => match.courtId!),
  );
  const levels = s.settings.allowDraws ? [] : round.matches.filter((m) => m.score && m.score.a === m.score.b);
  const unscored = round.matches.filter((m) => !m.score);

  useEffect(() => {
    void keepAwake(true);
    const onVisible = () => document.visibilityState === 'visible' && void keepAwake(true);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void keepAwake(false);
    };
  }, []);

  const sideNames = (ids: Id[]) => ids.map(name).join(' & ');
  const set = (m: Match, score: Score | null) => store.commit((x) => A.setMatchScore(x, round.id, m.id, score));
  const half = (m: Match, side: 'a' | 'b') => {
    const ids = side === 'a' ? m.sideA : m.sideB;
    return (
      <>
        {ids.map((id) => (
          <button class="name-btn" onClick={() => setWithdrawing(id)}>
            {name(id)}
          </button>
        ))}
        <ScorePad
          label={`${sideNames(ids)} score`}
          value={m.score ? m.score[side] : null}
          onChange={(f) => store.commit((x) => A.adjustMatchScore(x, round.id, m.id, side, f))}
        />
      </>
    );
  };

  return (
    <>
      <div class="page-head">
        <h2>Round {roundNumber(s)}</h2>
        <span class="eyebrow">{target ? `First to ${target}${s.settings.allowDraws ? '' : ' · golden point'}` : 'In play'}</span>
      </div>
      <Timer round={round} />
      {round.matches.map((m) => (
        <CourtCard
          key={m.id}
          title={courtName(m.courtId)}
          kind={kindLabel(s, m)}
          a={half(m, 'a')}
          b={half(m, 'b')}
          foot={
            <>
              <span class="row">
                {!m.score && <span class="flag">Not scored yet</span>}
                {m.score && levels.includes(m) && <span class="flag">Level — golden point decides it</span>}
                {playoffCourts.has(m.courtId) && <span class="flag">Playoff also assigned here</span>}
              </span>
              {m.score && (
                <button class="btn link small" onClick={() => set(m, null)}>
                  Clear
                </button>
              )}
            </>
          }
        />
      ))}
      {round.sittingOut.length > 0 && (
        <p class="muted">
          <span class="eyebrow">Sitting out</span> {round.sittingOut.map(name).join(', ')}
        </p>
      )}
      <p class="small muted">Tap a name if someone has to stop (injury or leaving).</p>
      {levels.length > 0 ? (
        <p class="banner">Draws are off. Enter the golden point on {levels.map((m) => courtName(m.courtId)).join(', ')} before ending the round.</p>
      ) : ending && unscored.length > 0 ? (
        <div class="banner">
          <p>
            {unscored.map((m) => courtName(m.courtId)).join(', ')} {unscored.length > 1 ? 'have' : 'has'} no score. They'll be saved as unscored and flagged in History.
          </p>
          <div class="row">
            <button class="btn" onClick={() => store.commit((x) => A.endRound(x, Date.now()))}>
              End anyway
            </button>
            <button class="btn" onClick={() => setEnding(false)}>
              Keep playing
            </button>
          </div>
        </div>
      ) : (
        <button class="btn primary big block" onClick={() => (unscored.length ? setEnding(true) : store.commit((x) => A.endRound(x, Date.now())))}>
          End round & save scores
        </button>
      )}
      {withdrawing && (
        <Sheet title={name(withdrawing)} onClose={() => setWithdrawing(null)}>
          <p>Has {name(withdrawing)} had to stop? Their current score stands, and the next rounds are planned without them. You can bring them back from Setup.</p>
          <button
            class="btn danger big block"
            onClick={() => {
              store.commit((x) => A.setActive(x, withdrawing, false));
              setWithdrawing(null);
            }}
          >
            Withdraw {name(withdrawing)}
          </button>
          <a href={`#/player/${withdrawing}`} onClick={() => setWithdrawing(null)}>
            See {name(withdrawing)}'s matches
          </a>
        </Sheet>
      )}
    </>
  );
}
