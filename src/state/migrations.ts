import { SCHEMA_VERSION } from '../domain/types';

/**
 * migrations[n] upgrades data saved at version n to version n + 1. Add one here whenever the
 * saved shape changes, and bump SCHEMA_VERSION; never edit a migration that has shipped.
 */
export const migrations: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {};

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
