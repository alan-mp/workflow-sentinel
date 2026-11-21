import { readFileSync } from 'node:fs';
import {
  InMemoryDirectory,
  activateVersion,
  createDraft,
  type FlowDefinition,
  type FlowVersion,
  type OrgUnit,
  type User,
} from '../src/index';

const read = (name: string) =>
  JSON.parse(readFileSync(new URL(`../examples/${name}.json`, import.meta.url), 'utf8'));

export const users: User[] = read('directory');
export const units: OrgUnit[] = read('org');
export const directory = new InMemoryDirectory({ users, units });
export const definition = (name: string): FlowDefinition => read(name);
export const NOW = new Date('2026-12-01T02:00:00.000Z');
export const ctx = { directory, now: NOW };

/** Versi aktif: disusun u_hana, diaktifkan u_dewi. */
export function activeVersion(def: FlowDefinition, id = `${def.key}-v1`): FlowVersion {
  const draft = createDraft({
    id,
    flowKey: def.key,
    version: 1,
    definition: def,
    createdBy: 'u_hana',
    sopUrl: 'https://example.test/sop.pdf',
  });
  return activateVersion(draft, {
    actor: { type: 'user', id: 'u_dewi' },
    effectiveFrom: '2026-11-01T00:00:00.000Z',
    now: new Date('2026-11-01T00:00:00.000Z'),
  }).version;
}
