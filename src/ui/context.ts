import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Id, Session } from '../domain/types';
import type { Store } from '../state/store';

export const StoreContext = createContext<Store>(null as unknown as Store);

export function useStore(): Store {
  return useContext(StoreContext);
}

/** The active session; views are only rendered when one exists. */
export function useSession(): Session {
  return useStore().get().session!;
}

export function useNames(): (id: Id) => string {
  const s = useSession();
  const map = new Map(s.players.map((p) => [p.id, p.name]));
  return (id) => map.get(id) ?? '?';
}

export function useCourtName(): (id: Id | null) => string {
  const s = useSession();
  const map = new Map(s.courts.map((c) => [c.id, c.name]));
  return (id) => (id ? (map.get(id) ?? 'Court') : '');
}

/** Re-renders every `ms` while `active`, returning the current time. */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return active ? now : Date.now();
}

export function useHash(): string {
  const [hash, setHash] = useState(location.hash || '#/round');
  useEffect(() => {
    const on = () => setHash(location.hash || '#/round');
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export function go(hash: string): void {
  location.hash = hash;
}
