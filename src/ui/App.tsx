import { useEffect, useReducer, useState } from 'preact/hooks';
import * as A from '../domain/actions';
import { importSession } from '../state/persistence';
import type { Store } from '../state/store';
import { Icon, pickFile } from './components';
import { StoreContext, useHash } from './context';
import { HistoryView } from './views/HistoryView';
import { PlayerView } from './views/PlayerView';
import { PlayoffsView } from './views/PlayoffsView';
import { RoundView } from './views/RoundView';
import { SetupView } from './views/SetupView';
import { standingsOf, TableView } from './views/TableView';

const TABS = [
  ['round', 'Round'],
  ['table', 'Table'],
  ['playoffs', 'Playoffs'],
  ['history', 'History'],
  ['setup', 'Setup'],
] as const;

export function App({ store }: { store: Store }) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => store.subscribe(() => rerender(undefined)), [store]);
  const theme = store.get().prefs.theme;
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <StoreContext.Provider value={store}>
      <Shell store={store} />
    </StoreContext.Provider>
  );
}

function Shell({ store }: { store: Store }) {
  const hash = useHash();
  const s = store.get().session;
  const [dismissed, setDismissed] = useState(false);
  const save = store.lastSave();
  const banners = (
    <>
      {store.loadWarning && !dismissed && (
        <div class="banner" role="alert">
          {store.loadWarning}{' '}
          <button class="btn ghost small" onClick={() => setDismissed(true)}>
            OK
          </button>
        </div>
      )}
      {!save.ok && (
        <div class="banner" role="alert">
          Couldn't save on this phone ({save.error}). Export a backup from Setup now.
        </div>
      )}
    </>
  );

  if (!s) {
    return (
      <div class="app">
        <main>
          {banners}
          <Welcome store={store} />
        </main>
      </div>
    );
  }

  const [, route, arg] = hash.split('/');
  const st = standingsOf(s);
  // Ties are shown on the table; the tab only nags when a playoff result has gone stale.
  const playoffAttention = st.stale.size > 0;
  const view =
    route === 'player' && arg ? (
      <PlayerView id={arg} />
    ) : route === 'table' ? (
      <TableView />
    ) : route === 'playoffs' ? (
      <PlayoffsView />
    ) : route === 'history' ? (
      <HistoryView />
    ) : route === 'setup' ? (
      <SetupView />
    ) : (
      <RoundView />
    );
  const current = route === 'player' ? 'table' : TABS.some(([t]) => t === route) ? route : 'round';

  return (
    <div class="app">
      <header class="top">
        <h1>{s.name}</h1>
        {A.liveRound(s) && <span class="live">Live</span>}
        <button class="btn" onClick={() => store.undo()} disabled={!store.canUndo()} aria-label="Undo last change">
          ↶ Undo
        </button>
      </header>
      <main>
        {banners}
        {view}
      </main>
      <nav class="tabs" aria-label="Sections">
        {TABS.map(([t, label]) => (
          <a href={`#/${t}`} aria-current={current === t ? 'page' : undefined}>
            <Icon name={t} />
            {label}
            {t === 'playoffs' && playoffAttention && <span class="dot" aria-label="needs attention" />}
          </a>
        ))}
      </nav>
    </div>
  );
}

function Welcome({ store }: { store: Store }) {
  const [name, setName] = useState('Badminton');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  return (
    <>
      <div class="section" style="gap:6px;padding-top:12px">
        <span class="eyebrow">Social badminton</span>
        <h2 class="hero-name">Racquet Time</h2>
        <p class="muted">Rotating singles & doubles courts, a live leaderboard and tie-break playoffs. Everything stays on this phone.</p>
      </div>
      <form
        class="panel"
        onSubmit={(e) => {
          e.preventDefault();
          store.replace(A.newSession(name.trim() || 'Badminton', date));
          location.hash = '#/setup';
        }}
      >
        <h3>New session</h3>
        <label class="field">
          <span>Name</span>
          <input type="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="field">
          <span>Date</span>
          <input type="date" value={date} onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <button class="btn primary big block" type="submit">
          Create session
        </button>
      </form>
      <button
        class="btn block"
        onClick={async () => {
          const file = await pickFile('application/json,.json');
          if (!file) return;
          try {
            store.replace(importSession(await file.text()));
          } catch (e) {
            alert((e as Error).message);
          }
        }}
      >
        Import a session (JSON)
      </button>
    </>
  );
}
