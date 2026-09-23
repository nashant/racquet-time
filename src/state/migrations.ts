import { SCHEMA_VERSION } from '../domain/types';

/**
 * migrations[n] upgrades data saved at version n to version n + 1. Add one here whenever the
 * saved shape changes, and bump SCHEMA_VERSION; never edit a migration that has shipped.
 */
export const migrations: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {
  // v2: players gain sitCredit. Applies to saved state (session + undo) and export files (session).
  1: (data) => {
    const upgrade = (s: unknown) => {
      if (!s || typeof s !== 'object' || !Array.isArray((s as { players?: unknown }).players)) return s;
      const session = s as { players: Record<string, unknown>[] };
      return { ...session, players: session.players.map((p) => ({ ...p, sitCredit: typeof p.sitCredit === 'number' ? p.sitCredit : 0 })) };
    };
    return {
      ...data,
      session: upgrade(data.session),
      ...(Array.isArray(data.undo) ? { undo: data.undo.map(upgrade) } : {}),
    };
  },
};

export class NewerVersionError extends Error {}

/** Upgrades any saved/exported object carrying a `version` to the current schema. */
export function migrate(data: Record<string, unknown>): Record<string, unknown> {
  let version = typeof data.version === 'number' ? data.version : 1;
  if (version > SCHEMA_VERSION) throw new NewerVersionError(`Saved by a newer version of the app (v${version}).`);
  let out = { ...data, version };
  while (version < SCHEMA_VERSION) {
    const step = migrations[version];
    if (!step) throw new Error(`No migration from v${version}`);
    out = { ...step(out), version: ++version };
  }
  return out;
}
