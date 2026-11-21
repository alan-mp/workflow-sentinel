import { describe, expect, it } from 'vitest';
import { act, resubmit, startRequest, type RequestState } from '../src/index';
import { activeVersion, ctx, definition } from './helpers';

const open = (s: RequestState) => s.tasks.filter((t) => t.status === 'open').map((t) => t.stepId);
const approve = (s: RequestState, v: ReturnType<typeof activeVersion>, stepId: string, actorId: string) =>
  act(s, v, { actorId, taskId: s.tasks.find((t) => t.stepId === stepId && t.status === 'open')!.id, type: 'approve' }, ctx);

const bigPurchase = { amount: 150_000_000, category: 'mesin', description: 'Mesin press' };

describe('menjalankan alur', () => {
  it('berurutan lalu paralel: semua cabang harus setuju sebelum lanjut', async () => {
    const v = activeVersion(definition('purchase'));
    let { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: bigPurchase }, ctx);
    expect(open(state)).toEqual(['atasan']);

    ({ state } = await approve(state, v, 'atasan', 'u_maya'));
    expect(open(state).sort()).toEqual(['keuangan', 'teknis']);

    ({ state } = await approve(state, v, 'keuangan', 'u_fajar'));
    expect(open(state)).toEqual(['teknis']);

    ({ state } = await approve(state, v, 'teknis', 'u_putra'));
    expect(open(state)).toEqual(['direktur']);

    const last = await approve(state, v, 'direktur', 'u_dewi');
    expect(last.state.status).toBe('approved');
    expect(last.events.map((e) => e.action)).toEqual([
      'task_approved',
      'notification_requested',
      'request_approved',
    ]);
  });

  it('tolak menghentikan permintaan dan membatalkan tugas lain', async () => {
    const v = activeVersion(definition('purchase'));
    let { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: bigPurchase }, ctx);
    ({ state } = await approve(state, v, 'atasan', 'u_maya'));
    const task = state.tasks.find((t) => t.stepId === 'keuangan')!;
    ({ state } = await act(state, v, { actorId: 'u_fajar', taskId: task.id, type: 'reject', comment: 'Di luar anggaran' }, ctx));
    expect(state.status).toBe('rejected');
    expect(state.tasks.find((t) => t.stepId === 'teknis')!.status).toBe('cancelled');
  });

  it('minta revisi: pemohon kirim ulang dan approval diulang dari awal', async () => {
    const v = activeVersion(definition('purchase'));
    let { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: bigPurchase }, ctx);
    ({ state } = await approve(state, v, 'atasan', 'u_maya'));
    const task = state.tasks.find((t) => t.stepId === 'teknis')!;
    ({ state } = await act(state, v, { actorId: 'u_putra', taskId: task.id, type: 'request_revision' }, ctx));
    expect(state.status).toBe('revision_requested');

    await expect(resubmit(state, v, { actorId: 'u_maya', data: bigPurchase }, ctx)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    ({ state } = await resubmit(state, v, { actorId: 'u_budi', data: { ...bigPurchase, amount: 5_000_000 } }, ctx));
    expect(state.round).toBe(2);
    expect(open(state)).toEqual(['atasan']);
  });

  it('tugas menyimpan tenggat sesuai SLA langkah', async () => {
    const v = activeVersion(definition('purchase'));
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data: bigPurchase }, ctx);
    expect(state.tasks[0]!.dueAt).toBe('2026-12-02T02:00:00.000Z');
  });

  it('menolak data yang tidak sesuai field alur', async () => {
    const v = activeVersion(definition('purchase'));
    await expect(
      startRequest(v, { id: 'r1', requesterId: 'u_budi', data: { amount: '5 juta', category: 'it', description: 'x' } }, ctx),
    ).rejects.toMatchObject({ code: 'INVALID_DATA' });
  });

  it('permintaan berjalan tetap memakai versi saat dibuat', async () => {
    const v1 = activeVersion(definition('leave'), 'leave-v1');
    const changed = definition('leave');
    changed.steps.splice(1, 1); // v2 membuang langkah atasan tingkat 2
    const v2 = activeVersion(changed, 'leave-v2');

    const data = { leave_type: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-20', days: 8 };
    let { state } = await startRequest(v1, { id: 'r1', requesterId: 'u_budi', data }, ctx);
    expect(state.flowVersionId).toBe('leave-v1');

    await expect(approve(state, v2, 'atasan', 'u_maya')).rejects.toMatchObject({ code: 'INVALID_STATE' });
    ({ state } = await approve(state, v1, 'atasan', 'u_maya'));
    expect(open(state)).toEqual(['atasan_2']);
  });
});
