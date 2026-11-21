import { describe, expect, it } from 'vitest';
import { act, activateVersion, createDraft, editDraft, startRequest } from '../src/index';
import { NOW, activeVersion, ctx, definition } from './helpers';

const purchase = { amount: 20_000_000, category: 'atk', description: 'x' };

describe('pemisahan tugas pada permintaan', () => {
  it('pemohon tidak bisa menyetujui permintaannya sendiri', async () => {
    const v = activeVersion(definition('purchase'));
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: purchase }, ctx);
    await expect(
      act(state, v, { actorId: 'u_budi', taskId: state.tasks[0]!.id, type: 'approve' }, ctx),
    ).rejects.toMatchObject({ code: 'SOD_VIOLATION' });
  });

  it('tetap ditolak walau pemohon masuk daftar approver lewat data yang salah', async () => {
    const v = activeVersion(definition('purchase'));
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: purchase }, ctx);
    state.tasks[0]!.assignees.push('u_budi');
    await expect(
      act(state, v, { actorId: 'u_budi', taskId: state.tasks[0]!.id, type: 'approve' }, ctx),
    ).rejects.toMatchObject({ code: 'SOD_VIOLATION' });
  });

  it('pemohon tidak bisa menyetujui lewat delegasi dari atasannya', async () => {
    const v = activeVersion(definition('purchase'));
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: purchase }, ctx);
    const delegations = [
      { fromUserId: 'u_maya', toUserId: 'u_budi', startsAt: '2026-11-30T00:00:00.000Z', endsAt: '2026-12-05T00:00:00.000Z' },
    ];
    await expect(
      act(state, v, { actorId: 'u_budi', taskId: state.tasks[0]!.id, type: 'approve' }, { ...ctx, delegations }),
    ).rejects.toMatchObject({ code: 'SOD_VIOLATION' });
  });

  it('pemohon yang juga satu-satunya approver dialihkan ke atasannya', async () => {
    const v = activeVersion(definition('purchase'));
    // Fajar adalah satu-satunya finance_manager; atasannya Dewi.
    let { state } = await startRequest(v, { id: 'r1', requesterId: 'u_fajar', data: purchase }, ctx);
    ({ state } = await act(state, v, { actorId: 'u_dewi', taskId: state.tasks[0]!.id, type: 'approve' }, ctx));
    const finance = state.tasks.find((t) => t.stepId === 'keuangan')!;
    expect(finance.assignees).toEqual(['u_dewi']);
  });

  it('bukan approver ditolak', async () => {
    const v = activeVersion(definition('purchase'));
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: purchase }, ctx);
    await expect(
      act(state, v, { actorId: 'u_hana', taskId: state.tasks[0]!.id, type: 'approve' }, ctx),
    ).rejects.toMatchObject({ code: 'NOT_ASSIGNEE' });
  });
});

describe('delegasi berbatas waktu', () => {
  const delegation = (startsAt: string, endsAt: string) => [
    { fromUserId: 'u_maya', toUserId: 'u_putra', startsAt, endsAt },
  ];

  it('delegasi aktif boleh memutuskan dan tercatat atas nama siapa', async () => {
    const v = activeVersion(definition('purchase'));
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: purchase }, ctx);
    const delegations = delegation('2026-11-30T00:00:00.000Z', '2026-12-05T00:00:00.000Z');
    const r = await act(state, v, { actorId: 'u_putra', taskId: state.tasks[0]!.id, type: 'approve' }, { ...ctx, delegations });
    expect(r.state.tasks[0]).toMatchObject({ actedBy: 'u_putra', onBehalfOf: 'u_maya' });
    expect(r.events[0]!.detail).toMatchObject({ onBehalfOf: 'u_maya' });
  });

  it('delegasi yang sudah lewat atau belum mulai ditolak', async () => {
    const v = activeVersion(definition('purchase'));
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: purchase }, ctx);
    for (const delegations of [
      delegation('2026-11-01T00:00:00.000Z', '2026-12-01T02:00:00.000Z'),
      delegation('2026-12-02T00:00:00.000Z', '2026-12-05T00:00:00.000Z'),
    ]) {
      await expect(
        act(state, v, { actorId: 'u_putra', taskId: state.tasks[0]!.id, type: 'approve' }, { ...ctx, delegations }),
      ).rejects.toMatchObject({ code: 'NOT_ASSIGNEE' });
    }
  });
});

describe('pemisahan tugas pada aktivasi alur', () => {
  const draft = () =>
    createDraft({
      id: 'purchase-v2',
      flowKey: 'purchase',
      version: 2,
      definition: definition('purchase'),
      createdBy: 'u_hana',
      sopUrl: 'https://example.test/sop.pdf',
    });
  const activate = (v: ReturnType<typeof draft>, actor: Parameters<typeof activateVersion>[1]['actor']) =>
    activateVersion(v, { actor, effectiveFrom: '2026-12-15T00:00:00.000Z', now: NOW });

  it('penyusun draf tidak bisa mengaktifkan drafnya sendiri', () => {
    expect(() => activate(draft(), { type: 'user', id: 'u_hana' })).toThrowError(/Draft authors/);
  });

  it('siapa pun yang pernah mengedit draf juga tidak bisa', () => {
    const edited = editDraft(draft(), 'u_fajar', { definition: definition('purchase') });
    expect(() => activate(edited, { type: 'user', id: 'u_fajar' })).toThrowError(/Draft authors/);
  });

  it('AI tidak pernah bisa mengaktifkan', () => {
    expect(() => activate(draft(), { type: 'ai', id: 'chat' })).toThrowError(/Only a person/);
  });

  it('orang kedua bisa; versi menyimpan tanggal berlaku dan tautan SOP', () => {
    const { version } = activate(draft(), { type: 'user', id: 'u_dewi' });
    expect(version).toMatchObject({
      status: 'active',
      activatedBy: 'u_dewi',
      effectiveFrom: '2026-12-15T00:00:00.000Z',
      sopUrl: 'https://example.test/sop.pdf',
    });
  });

  it('draf tanpa tautan SOP atau dengan definisi tidak valid tidak bisa diaktifkan', () => {
    const noSop = { ...draft(), sopUrl: undefined };
    expect(() => activate(noSop, { type: 'user', id: 'u_dewi' })).toThrowError(/SOP/);
    const broken = draft();
    broken.definition.steps.shift();
    expect(() => activate(broken, { type: 'user', id: 'u_dewi' })).toThrowError(/without a human approval/);
  });

  it('versi aktif tidak bisa diubah, dan belum dipakai sebelum tanggal berlaku', async () => {
    const { version } = activate(draft(), { type: 'user', id: 'u_dewi' });
    expect(() => editDraft(version, 'u_hana', {})).toThrowError(/cannot be edited/);
    await expect(
      startRequest(version, { id: 'r1', requesterId: 'u_budi', data: purchase }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });
});
