import { render } from 'preact';
import { createStore, MemoryStorage } from './state/store';
import { App } from './ui/App';
import './ui/styles.css';

function storage(): Storage {
  try {
    const probe = '__racquet_time_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return new MemoryStorage();
  }
}

const store = createStore(storage());
render(<App store={store} />, document.getElementById('app')!);

// The app loaded, so any earlier stale-copy recovery (see index.html) worked; allow it again later.
try {
  sessionStorage.removeItem('rt-recovered');
} catch {
  // Storage blocked; the recovery guard just stays set for this tab.
}

// Ask the browser not to evict our data under storage pressure.
void navigator.storage?.persist?.();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  addEventListener('load', () => void navigator.serviceWorker.register('/sw.js'));
}
