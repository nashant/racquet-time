import { useState } from 'preact/hooks';
import * as A from '../../domain/actions';
import { ALL_METRICS, type Player, type Tiebreaker } from '../../domain/types';
import { exportSession, importSession, readRescue } from '../../state/persistence';
import { download, pickFile, ReorderList, Seg, Stepper } from '../components';
import { useSession, useStore } from '../context';
import { PRIORITY_LABEL, slug, TIEBREAKER_LABEL } from '../labels';
import { ConfirmButton } from './RoundView';

export function SetupView() {
  return (
    <>
      <div class="page-head">
        <h2>Setup</h2>
        <span class="eyebrow">Players · courts · rules</span>
      </div>
      <SessionCard />
      <PlayersCard />
      <CourtsCard />
      <FormatCard />
      <RankingCard />
      <AdvancedCard />
      <DataCard />
    </>
  );
}

function SessionCard() {
  const store = useStore();
  const s = useSession();
  return (
    <div class="panel">
      <h3>Session</h3>
      <label class="field">
        <span>Name</span>
        <input type="text" value={s.name} onChange={(e) => store.commit((x) => A.renameSession(x, (e.currentTarget as HTMLInputElement).value, x.date))} />
      </label>
      <label class="field">
        <span>Date</span>
        <input type="date" value={s.date} onChange={(e) => store.commit((x) => A.renameSession(x, x.name, (e.currentTarget as HTMLInputElement).value))} />
      </label>
    </div>
  );
}

function PlayerRow({ p }: { p: Player }) {
  const store = useStore();
  const s = useSession();
  const [name, setName] = useState(p.name);
  const canRemove = !A.hasHistory(s, p.id);
  const live = A.liveRound(s);
  const onCourt = live?.matches.some((m) => [...m.sideA, ...m.sideB].includes(p.id));
  return (
    <li class="row" style="flex-direction:row">
      <input
        type="text"
        id={`player-${p.id}`}
        aria-label={`Name for ${p.name}`}
        style="flex:1;min-width:8em"
        value={name}
        onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
        onBlur={() => (name.trim() ? store.commit((x) => A.renamePlayer(x, p.id, name)) : setName(p.name))}
      />
      <label class="check" title="Playing">
        <input
          type="checkbox"
          checked={p.active}
          onChange={(e) => {
            const on = (e.currentTarget as HTMLInputElement).checked;
            if (!on && onCourt && !confirm(`${p.name} is on court. Withdraw them? Their current score stands.`)) {
              (e.currentTarget as HTMLInputElement).checked = true;
              return;
            }
            store.commit((x) => A.setActive(x, p.id, on));
          }}
        />
        <span class="small">{p.active ? 'Playing' : 'Out'}</span>
      </label>
      {p.playNext && <span class="flag">Plays next</span>}
      {canRemove && (
        <button class="btn icon danger" aria-label={`Remove ${p.name}`} onClick={() => store.commit((x) => A.removePlayer(x, p.id))}>
          ✕
        </button>
      )}
    </li>
  );
}

function PlayersCard() {
  const store = useStore();
  const s = useSession();
  const [single, setSingle] = useState('');
  const [paste, setPaste] = useState('');
  const active = s.players.filter((p) => p.active).length;
  const add = (names: string[]) => store.commit((x) => A.addPlayers(x, names));
  return (
    <div class="panel">
      <h3>
        Players <span class="muted small">({active} playing of {s.players.length})</span>
      </h3>
      <form
        class="row"
        onSubmit={(e) => {
          e.preventDefault();
          add([single]);
          setSingle('');
        }}
      >
        <input type="text" aria-label="New player name" placeholder="Add a player" style="flex:1" value={single} onInput={(e) => setSingle((e.currentTarget as HTMLInputElement).value)} />
        <button class="btn primary" type="submit" disabled={!single.trim()}>
          Add
        </button>
      </form>
      <details>
        <summary>Paste a list (one name per line)</summary>
        <textarea aria-label="Player names, one per line" value={paste} onInput={(e) => setPaste((e.currentTarget as HTMLTextAreaElement).value)} />
        <button
          class="btn primary block"
          disabled={!paste.trim()}
          onClick={() => {
            add(paste.split(/\r?\n/));
            setPaste('');
          }}
        >
          Add all
        </button>
      </details>
      <ul class="list">
        {s.players.map((p) => (
          <PlayerRow key={p.id} p={p} />
        ))}
      </ul>
      {s.rounds.some((r) => r.status !== 'preview') && (
        <p class="small muted">Players who join late or come back are brought level with the field and play next; sit-outs only count rounds they were here for. Players with matches can be marked out but not removed.</p>
      )}
    </div>
  );
}

function CourtsCard() {
  const store = useStore();
  const s = useSession();
  const live = A.liveRound(s);
  return (
    <div class="panel">
      <h3>Courts</h3>
      <ul class="list">
        {s.courts.map((c, i) => (
          <li key={c.id} class="row" style="flex-direction:row">
            <input
              type="text"
              aria-label={`Court ${i + 1} name`}
              style="flex:1;min-width:7em"
              value={c.name}
              onChange={(e) => store.commit((x) => A.updateCourt(x, c.id, { name: (e.currentTarget as HTMLInputElement).value || c.name }))}
            />
            <Seg
              label={`${c.name} type`}
              value={c.kind}
              onChange={(kind) => store.commit((x) => A.updateCourt(x, c.id, { kind }))}
              options={[
                ['doubles', 'Doubles'],
                ['singles', 'Singles'],
              ]}
            />
            <button class="btn icon" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => store.commit((x) => A.moveCourt(x, c.id, -1))}>
              ↑
            </button>
            <button
              class="btn icon danger"
              aria-label={`Remove ${c.name}`}
              disabled={!!live?.matches.some((m) => m.courtId === c.id)}
              onClick={() => store.commit((x) => A.removeCourt(x, c.id))}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div class="row">
        <button class="btn grow" onClick={() => store.commit((x) => A.addCourt(x, 'doubles'))}>
          + Doubles court
        </button>
        <button class="btn grow" onClick={() => store.commit((x) => A.addCourt(x, 'singles'))}>
          + Singles court
        </button>
      </div>
    </div>
  );
}

function FormatCard() {
  const store = useStore();
  const s = useSession();
  const f = s.settings.format;
  const set = (patch: Parameters<typeof A.updateSettings>[1]) => store.commit((x) => A.updateSettings(x, patch));
  return (
    <div class="panel">
      <h3>Round format</h3>
      <Seg
        label="Round format"
        value={f.kind}
        onChange={(kind) => set({ format: kind === 'timed' ? { kind: 'timed', minutes: 12 } : { kind: 'points', target: 21 } })}
        options={[
          ['timed', 'Timed'],
          ['points', 'First to N points'],
        ]}
      />
      {f.kind === 'timed' ? (
        <label class="field">
          <span>Minutes per round (one timer for all courts)</span>
          <Stepper label="Minutes per round" value={f.minutes} min={1} onChange={(minutes) => set({ format: { kind: 'timed', minutes } })} />
        </label>
      ) : (
        <label class="field">
          <span>Points to win</span>
          <Stepper label="Points to win" value={f.target} min={1} onChange={(target) => set({ format: { kind: 'points', target } })} />
        </label>
      )}
      <label class="check">
        <input type="checkbox" checked={s.settings.allowDraws} onChange={(e) => set({ allowDraws: (e.currentTarget as HTMLInputElement).checked })} />
        <span>Allow draws (off = golden point decides a level score)</span>
      </label>
      {A.liveRound(s) && <p class="small muted">Timer changes apply from the next round.</p>}
    </div>
  );
}

function RankingCard() {
  const store = useStore();
  const s = useSession();
  const tbs = s.settings.tiebreakers;
  const unused = ([...ALL_METRICS, 'headToHead'] as Tiebreaker[]).filter((m) => !tbs.includes(m));
  const set = (tiebreakers: Tiebreaker[]) => store.commit((x) => A.updateSettings(x, { tiebreakers }));
  return (
    <div class="panel">
      <h3>Ranking order</h3>
      <p class="small muted">Players are ordered by the first item; later items break ties. The table updates instantly.</p>
      <ReorderList items={tbs} label={(t) => TIEBREAKER_LABEL[t]} onChange={set} onRemove={tbs.length > 1 ? (t) => set(tbs.filter((x) => x !== t)) : undefined} />
      {unused.length > 0 && (
        <div class="row">
          {unused.map((m) => (
            <button class="btn" onClick={() => set([...tbs, m])}>
              + {TIEBREAKER_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AdvancedCard() {
  const store = useStore();
  const s = useSession();
  const st = s.settings;
  const set = (patch: Parameters<typeof A.updateSettings>[1]) => store.commit((x) => A.updateSettings(x, patch));
  return (
    <details class="panel">
      <summary>
        <h3>Advanced: rotation</h3>
      </summary>
      <div class="section">
        <p class="small muted">Priority order for generating rounds (top matters most).</p>
        <ReorderList items={st.priorities} label={(p) => PRIORITY_LABEL[p]} onChange={(priorities) => set({ priorities })} />
        <label class="check">
          <input type="checkbox" checked={st.skillBalance} onChange={(e) => set({ skillBalance: (e.currentTarget as HTMLInputElement).checked })} />
          <span>Balance teams by current win %</span>
        </label>
        <label class="field">
          <span>Not enough players for every court: fill</span>
          <Seg
            label="Fill order"
            value={st.fillOrder}
            onChange={(fillOrder) => set({ fillOrder })}
            options={[
              ['doublesFirst', 'Doubles first'],
              ['singlesFirst', 'Singles first'],
            ]}
          />
        </label>
        <label class="field">
          <span>A doubles court that can't get 4 players</span>
          <Seg
            label="Short doubles court"
            value={st.shortDoubles}
            onChange={(shortDoubles) => set({ shortDoubles })}
            options={[
              ['asSingles', 'Play singles'],
              ['leaveEmpty', 'Leave empty'],
            ]}
          />
        </label>
      </div>
    </details>
  );
}

function DataCard() {
  const store = useStore();
  const s = useSession();
  const prefs = store.get().prefs;
  const rescue = readRescue(localStorageOrNull());
  const playedRounds = s.rounds.filter((r) => r.status !== 'preview').length;
  const doImport = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const session = importSession(await file.text());
      if (confirm(`Replace the current session with “${session.name}” (${session.date})? You can Undo this.`)) store.replace(session);
    } catch (e) {
      alert((e as Error).message);
    }
  };
  return (
    <div class="panel">
      <h3>Display</h3>
      <Seg
        label="Theme"
        value={prefs.theme}
        onChange={(theme) => store.setPrefs({ theme })}
        options={[
          ['auto', 'Auto'],
          ['light', 'Light'],
          ['dark', 'Dark'],
        ]}
      />
      <label class="check">
        <input type="checkbox" checked={prefs.sound} onChange={(e) => store.setPrefs({ sound: (e.currentTarget as HTMLInputElement).checked })} />
        <span>Sound when the timer ends</span>
      </label>
      <h3>Backup</h3>
      <p class="small muted">Everything is saved on this phone automatically. Export to back up or move to another phone.</p>
      <div class="row">
        <button class="btn grow" onClick={() => download(`racquet-time-${s.date}-${slug(s.name)}.json`, exportSession(s))}>
          Export JSON
        </button>
        <button class="btn grow" onClick={doImport}>
          Import JSON
        </button>
      </div>
      <h3>Start over</h3>
      <p class="small muted">Clears every round, score and playoff but keeps the players, courts and settings. You can Undo.</p>
      <ConfirmButton
        class="btn danger block"
        label="Clear all rounds & history"
        confirmLabel={`Tap again — deletes ${playedRounds} round${playedRounds === 1 ? '' : 's'}${s.playoffs.length ? ' and playoffs' : ''}`}
        disabled={!s.rounds.length && !s.playoffs.length}
        onConfirm={() => store.commit(A.clearRounds)}
      />
      <ConfirmButton
        class="btn danger block"
        label="Start a new session"
        confirmLabel="Tap again — export first to keep this one"
        onConfirm={() => store.replace(A.newSession('Badminton', new Date().toISOString().slice(0, 10)))}
      />
      {rescue && (
        <>
          <h3>Recovery</h3>
          <p class="small muted">Some saved data couldn't be opened earlier and was kept aside.</p>
          <button class="btn" onClick={() => download('racquet-time-recovered.json', rescue)}>
            Download recovered data
          </button>
        </>
      )}
    </div>
  );
}

function localStorageOrNull(): Storage {
  try {
    return localStorage;
  } catch {
    return { getItem: () => null } as unknown as Storage;
  }
}
