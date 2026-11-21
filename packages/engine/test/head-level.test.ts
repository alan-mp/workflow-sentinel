import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryDirectory, simulate, validateDefinition } from '../src';
import type { FlowDefinition } from '../src/definition';

const leave: FlowDefinition = JSON.parse(readFileSync(new URL('../examples/leave.json', import.meta.url), 'utf8'));
const dir = new InMemoryDirectory({
  users: [
    { id: 'u_dir', name: 'Direktur', department: 'direksi', roles: ['director'], unitId: 'direksi' },
    { id: 'u_gm', name: 'GM', department: 'div', roles: [], unitId: 'div' },
    { id: 'u_mgr', name: 'Manager', department: 'dept', roles: [], unitId: 'dept' },
    { id: 'u_staff', name: 'Staff', department: 'dept', roles: [], unitId: 'dept' },
    { id: 'u_hr', name: 'HR', department: 'dept', roles: ['hr'], unitId: 'dept' },
  ],
  units: [
    { id: 'direksi', name: 'Direksi', level: 'direksi', headUserId: 'u_dir' },
    { id: 'div', name: 'Divisi', level: 'divisi', parentId: 'direksi', headUserId: 'u_gm' },
    { id: 'dept', name: 'Departemen', level: 'departemen', parentId: 'div', headUserId: 'u_mgr' },
  ],
} as any);
const long = { leave_type: 'tahunan', start_date: '2026-12-01', end_date: '2026-12-09', days: 7 };
const route = async (who: string) =>
  (await simulate(leave, { requesterId: who, data: long }, dir, new Date('2026-11-22T00:00:00Z')))
    .filter((s) => s.type === 'approval' && !s.skipped)
    .map((s) => `${s.name}=${s.error ? 'ERROR' : s.userIds.join('|')}`);

describe('requester.head_of_level', () => {
  it('the leave flow with the division-head rule is valid', () => {
    expect(validateDefinition(leave).definition).toBeTruthy();
  });

  it('a division head\'s long leave goes to the Director and then HR, not to a missing second superior', async () => {
    expect(await route('u_gm')).toEqual(['Atasan langsung=u_dir', 'Persetujuan HR=u_hr']);
  });

  it('a department head and a staff member keep the superior\'s superior', async () => {
    expect(await route('u_mgr')).toEqual(['Atasan langsung=u_gm', 'Atasan dari atasan=u_dir']);
    expect(await route('u_staff')).toEqual(['Atasan langsung=u_mgr', 'Atasan dari atasan=u_gm']);
  });
});
