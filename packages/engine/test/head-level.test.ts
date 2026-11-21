import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InMemoryDirectory, coverageGaps, simulate, validateDefinition } from '../src';
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

  it('the coverage test skips branches a requester can never take, and still checks the ones that depend on the form', async () => {
    const at = new Date('2026-11-22T00:00:00Z');
    const gapsOf = async (id: string) => (await coverageGaps(leave, (await dir.getUser(id))!, dir, at)).map((g) => g.stepId);
    // The division head never reaches "superior's superior"; the Director has no superior at all.
    expect(await gapsOf('u_gm')).toEqual([]);
    expect((await gapsOf('u_dir')).sort()).toEqual(['atasan', 'atasan_2']);
    expect(await gapsOf('u_staff')).toEqual([]);
  });

  it('also when the rule is written as "long and division head" before "long" (the form the AI drafter used)', async () => {
    const at = new Date('2026-11-22T00:00:00Z');
    const flat: FlowDefinition = structuredClone(leave);
    const cond = flat.steps.find((x) => x.id === 'cuti_panjang') as any;
    cond.branches = [
      { when: [{ field: 'days', op: 'gt', value: 5 }, { field: 'requester.head_of_level', op: 'eq', value: 'divisi' }], steps: [{ type: 'approval', id: 'hr_manager', name: 'HR', approver: { kind: 'role', role: 'hr' } }] },
      { when: [{ field: 'days', op: 'gt', value: 5 }], steps: [{ type: 'approval', id: 'atasan_2', name: 'Atasan dari atasan', approver: { kind: 'manager', level: 2 } }] },
    ];
    cond.otherwise = [];
    const gapsOf = async (id: string) => (await coverageGaps(flat, (await dir.getUser(id))!, dir, at)).map((g) => g.stepId);
    expect(await gapsOf('u_gm')).toEqual([]);
    expect((await gapsOf('u_dir')).sort()).toEqual(['atasan', 'atasan_2']);
  });

  it('"not a division head" holds for people who head no unit', async () => {
    const def: FlowDefinition = structuredClone(leave);
    const cond = def.steps.find((x) => x.id === 'cuti_panjang') as any;
    cond.branches = [
      { when: [{ field: 'days', op: 'gt', value: 5 }, { field: 'requester.head_of_level', op: 'neq', value: 'divisi' }], steps: [{ type: 'approval', id: 'atasan_2', name: 'Atasan dari atasan', approver: { kind: 'manager', level: 2 } }] },
    ];
    cond.otherwise = [];
    const steps = async (who: string) =>
      (await simulate(def, { requesterId: who, data: long }, dir, new Date('2026-11-22T00:00:00Z'))).filter((s) => s.type === 'approval' && !s.skipped).map((s) => s.stepId);
    expect(await steps('u_staff')).toEqual(['atasan', 'atasan_2']);
    expect(await steps('u_mgr')).toEqual(['atasan', 'atasan_2']);
    expect(await steps('u_gm')).toEqual(['atasan']);
  });
});

