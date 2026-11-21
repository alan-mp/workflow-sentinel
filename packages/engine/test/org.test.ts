import { describe, expect, it } from 'vitest';
import {
  InMemoryDirectory,
  act,
  coverageGaps,
  orgFindings,
  rerouteOpenTasks,
  simulate,
  startRequest,
  superiorOf,
  unitHeadAt,
  type FlowDefinition,
  type OrgUnit,
  type ReportingException,
  type User,
} from '../src/index';
import { NOW, activeVersion, definition, units, users } from './helpers';

const user = (id: string) => users.find((u) => u.id === id)!;
const withUnits = (change: (u: OrgUnit[]) => void, extra: { exceptions?: ReportingException[]; users?: User[] } = {}) => {
  const copy = structuredClone(units);
  change(copy);
  return new InMemoryDirectory({ users: extra.users ?? users, units: copy, exceptions: extra.exceptions });
};
const unit = (list: OrgUnit[], id: string) => list.find((u) => u.id === id)!;
const base = new InMemoryDirectory({ users, units });
const at = (directory: InMemoryDirectory, flowKey?: string) => ({ directory, now: NOW, flowKey });

describe('atasan dihitung dari struktur unit', () => {
  it('anggota melapor ke kepala unitnya; kepala unit melapor ke kepala unit di atasnya', async () => {
    expect((await superiorOf(user('u_budi'), at(base))).user.id).toBe('u_maya');
    expect((await superiorOf(user('u_maya'), at(base))).user.id).toBe('u_putra');
    expect((await superiorOf(user('u_putra'), at(base))).user.id).toBe('u_dewi');
    await expect(superiorOf(user('u_dewi'), at(base))).rejects.toMatchObject({ code: 'ROUTING' });
  });

  it('kepala kosong: Plt yang masih berlaku dipakai, kalau tidak ada naik ke unit di atasnya dengan alasan', async () => {
    const vacant = withUnits((u) => delete unit(u, 'produksi_line').headUserId);
    const up = await superiorOf(user('u_budi'), at(vacant));
    expect(up.user.id).toBe('u_putra');
    expect(up.basis).toMatch(/escalated because head of Produksi Line is vacant/);

    const acting = withUnits((u) => Object.assign(unit(u, 'produksi_line'), { headUserId: undefined, actingHeadUserId: 'u_hadi', actingUntil: '2026-12-31T00:00:00.000Z' }));
    const plt = await superiorOf(user('u_budi'), at(acting));
    expect(plt.user.id).toBe('u_hadi');
    expect(plt.basis).toMatch(/acting head of Produksi Line/);

    const expired = withUnits((u) => Object.assign(unit(u, 'produksi_line'), { headUserId: undefined, actingHeadUserId: 'u_hadi', actingUntil: '2026-11-30T00:00:00.000Z' }));
    expect((await superiorOf(user('u_budi'), at(expired))).user.id).toBe('u_putra');
  });

  it('pengecualian pelaporan berlaku selama masanya, dan yang khusus alur menang atas yang umum', async () => {
    const span = { startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2027-01-01T00:00:00.000Z' };
    const directory = withUnits(() => {}, {
      exceptions: [
        { userId: 'u_budi', toUserId: 'u_irfan', reason: 'proyek ERP', ...span },
        { userId: 'u_budi', toUserId: 'u_hana', flowKey: 'leave', reason: 'cuti lewat HR', ...span },
        { userId: 'u_maya', toUserId: 'u_fajar', reason: 'sudah lewat', startsAt: '2026-01-01T00:00:00.000Z', endsAt: '2026-06-01T00:00:00.000Z' },
      ],
    });
    const general = await superiorOf(user('u_budi'), at(directory, 'purchase'));
    expect(general.user.id).toBe('u_irfan');
    expect(general.basis).toMatch(/reporting exception: proyek ERP/);
    expect((await superiorOf(user('u_budi'), at(directory, 'leave'))).user.id).toBe('u_hana');
    expect((await superiorOf(user('u_maya'), at(directory))).user.id).toBe('u_putra');
  });

  it('kepala unit menurut tingkat: memakai unit setingkat itu atau terdekat di atasnya', async () => {
    expect((await unitHeadAt(user('u_budi'), 'departemen', at(base))).user.id).toBe('u_putra');
    expect((await unitHeadAt(user('u_budi'), 'seksi', at(base))).user.id).toBe('u_maya');
    // Budi tidak berada di bawah unit tingkat "unit": dipakai departemen di atasnya.
    expect((await unitHeadAt(user('u_budi'), 'unit', at(base))).user.id).toBe('u_putra');
    // Putra kepala departemennya sendiri, jadi naik ke direksi.
    expect((await unitHeadAt(user('u_putra'), 'departemen', at(base))).user.id).toBe('u_dewi');
  });

  it('orang tanpa unit dan pohon yang berputar ditolak dengan pesan jelas', async () => {
    const lost = withUnits(() => {}, { users: users.map((u) => (u.id === 'u_budi' ? { ...u, unitId: undefined } : u)) });
    await expect(superiorOf({ ...user('u_budi'), unitId: undefined }, at(lost))).rejects.toThrow(/is not placed/);
    const loop = withUnits((u) => {
      unit(u, 'direksi').parentId = 'produksi_line';
      for (const x of u) delete x.headUserId;
    });
    await expect(superiorOf(user('u_budi'), at(loop))).rejects.toThrow(/forms a loop/);
  });
});

describe('aturan routing di atas struktur', () => {
  const flow = (steps: FlowDefinition['steps']): FlowDefinition => ({ key: 'uji', name: 'Uji', fields: [], tables: [], steps });

  it('tugas mencatat alasan penunjukan approver', async () => {
    const v = activeVersion(definition('leave'));
    const { state, events } = await startRequest(
      v,
      { id: 'r1', requesterId: 'u_budi', data: { leave_type: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-11', days: 2 } },
      { directory: base, now: NOW },
    );
    expect(state.tasks[0]).toMatchObject({ assignees: ['u_maya'], basis: 'head of Produksi Line' });
    expect(events.find((e) => e.action === 'task_created')?.detail?.basis).toBe('head of Produksi Line');
  });

  it('approver dari struktur tidak mengulang orang yang sudah menyetujui, selama masih ada atasan di atasnya', async () => {
    // Kepala seksi kosong: atasan langsung dan kepala departemen sama-sama jatuh ke Putra.
    const directory = withUnits((u) => delete unit(u, 'produksi_line').headUserId);
    const def = flow([
      { type: 'approval', id: 'atasan', name: 'Atasan', approver: { kind: 'manager', level: 1 } },
      { type: 'approval', id: 'kadep', name: 'Kepala departemen', approver: { kind: 'unit_head', level: 'departemen' } },
    ]);
    const v = activeVersion(def);
    const ctx = { directory, now: NOW };
    const started = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: {} }, ctx);
    expect(started.state.tasks[0]!.assignees).toEqual(['u_putra']);
    const next = await act(started.state, v, { actorId: 'u_putra', taskId: started.state.tasks[0]!.id, type: 'approve' }, ctx);
    expect(next.state.tasks[1]!.assignees).toEqual(['u_dewi']);
    expect(next.state.tasks[1]!.basis).toMatch(/escalated because Putra .* already approved an earlier step/);
    const sim = await simulate(def, { requesterId: 'u_budi', data: {} }, directory, NOW);
    expect(sim.map((s) => s.userIds)).toEqual([['u_putra'], ['u_dewi']]);
  });

  it('wewenang bercakupan unit hanya berlaku untuk pemohon di bawah unit itu', async () => {
    const directory = new InMemoryDirectory({
      users,
      units,
      holders: { hrbp: [{ userId: 'u_hana', scopeUnitId: 'produksi' }, { userId: 'u_sari', scopeUnitId: 'it' }] },
    });
    const def = flow([{ type: 'approval', id: 'hrbp', name: 'HRBP', approver: { kind: 'role', role: 'hrbp' } }]);
    expect((await simulate(def, { requesterId: 'u_budi', data: {} }, directory, NOW))[0]?.userIds).toEqual(['u_hana']);
    expect((await simulate(def, { requesterId: 'u_hadi', data: {} }, directory, NOW))[0]?.userIds).toEqual(['u_sari']);
    expect((await simulate(def, { requesterId: 'u_pandu', data: {} }, directory, NOW))[0]?.error).toMatch(/No holder of authority hrbp/);
  });

  it('tugas terbuka mengikuti struktur: pindah saat kepala unit diganti, dan tercatat', async () => {
    const v = activeVersion(definition('leave'));
    const data = { leave_type: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-11', days: 2 };
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data }, { directory: base, now: NOW });
    const changed = withUnits((u) => (unit(u, 'produksi_line').headUserId = 'u_hadi'));
    const r = await rerouteOpenTasks(state, v, { directory: changed, now: NOW });
    expect(r.state.tasks[0]!.assignees).toEqual(['u_hadi']);
    expect(r.events[0]).toMatchObject({ action: 'task_reassigned', detail: { previous: ['u_maya'], assignees: ['u_hadi'] } });
    expect((await rerouteOpenTasks(state, v, { directory: base, now: NOW })).events).toEqual([]);
  });
});

describe('penjagaan struktur', () => {
  it('temuan: unit tanpa kepala, Plt kedaluwarsa, orang tanpa unit, wewenang tanpa atau satu pemegang', () => {
    const snapshot = {
      users: [...users.filter((u) => u.id !== 'u_budi'), { ...user('u_budi'), unitId: undefined }],
      units: structuredClone(units).map((u) =>
        u.id === 'produksi_line' ? { ...u, headUserId: undefined } : u.id === 'purchasing' ? { ...u, headUserId: undefined, actingHeadUserId: 'u_pandu', actingUntil: '2026-11-01T00:00:00.000Z' } : u,
      ),
      holders: { director: [{ userId: 'u_dewi' }], kosong: [] },
    };
    const codes = orgFindings(snapshot, NOW).map((f) => `${f.code}:${f.unitId ?? f.userId ?? f.authorityId}`);
    expect(codes).toEqual(
      expect.arrayContaining(['UNIT_NO_HEAD:produksi_line', 'ACTING_EXPIRED:purchasing', 'USER_NO_UNIT:u_budi', 'AUTHORITY_NO_HOLDER:kosong', 'AUTHORITY_SINGLE_HOLDER:director']),
    );
    expect(orgFindings({ users, units, holders: {} }, NOW)).toEqual([]);
  });

  it('uji cakupan menemukan orang yang jalurnya buntu, termasuk lewat baris tabel aturan', async () => {
    const def = definition('purchase');
    expect(await coverageGaps(def, user('u_budi'), base, NOW)).toEqual([]);
    // Direktur tidak punya atasan: langkah "atasan langsung" buntu untuknya.
    expect((await coverageGaps(def, user('u_dewi'), base, NOW)).map((g) => g.stepId)).toEqual(['atasan']);
    const noFinance = new InMemoryDirectory({ users: users.map((u) => ({ ...u, roles: (u.roles ?? []).filter((r) => r !== 'finance_manager') })), units });
    const gaps = await coverageGaps(def, user('u_budi'), noFinance, NOW);
    expect(gaps).toEqual([expect.objectContaining({ stepId: 'keuangan', tableRow: { tableId: 'approver_keuangan', rowId: '10jt_ke_atas' } })]);
  });
});
