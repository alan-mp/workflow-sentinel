import { describe, expect, it } from 'vitest';
import { act, startRequest, type AuditEvent } from '../src/index';
import { activeVersion, ctx, definition } from './helpers';

const deepFreeze = <T>(o: T): T => {
  if (o && typeof o === 'object') {
    Object.values(o).forEach(deepFreeze);
    Object.freeze(o);
  }
  return o;
};

describe('audit trail', () => {
  it('setiap event mencatat siapa, kapan, aksi apa, dan versi aturan', async () => {
    const v = activeVersion(definition('purchase'));
    const data = { amount: 20_000_000, category: 'it', description: 'Server' };
    const log: AuditEvent[] = [];
    let r = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data }, ctx);
    log.push(...r.events);
    r = await act(
      r.state,
      v,
      { actorId: 'u_maya', taskId: r.state.tasks[0]!.id, type: 'approve', comment: 'OK', attachmentIds: ['f1'] },
      ctx,
    );
    log.push(...r.events);

    for (const e of log) {
      expect(e.at).toBe(ctx.now.toISOString());
      expect(e.actor.type).toMatch(/user|system/);
      expect(e.action).toBeTruthy();
      expect(e.flowVersionId).toBe('purchase-v1');
      expect(e.requestId).toBe('r1');
    }
    expect(log.map((e) => e.action)).toEqual([
      'request_submitted',
      'task_created',
      'task_approved',
      'task_created',
      'task_created',
    ]);
    expect(log[0]!.actor).toEqual({ type: 'user', id: 'u_budi' });
    expect(log[2]).toMatchObject({
      actor: { type: 'user', id: 'u_maya' },
      stepId: 'atasan',
      detail: { comment: 'OK', attachmentIds: ['f1'] },
    });
  });

  it('routing lewat tabel mencatat baris aturan yang dipakai', async () => {
    const v = activeVersion(definition('purchase'));
    const data = { amount: 20_000_000, category: 'it', description: 'Server' };
    let r = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data }, ctx);
    r = await act(r.state, v, { actorId: 'u_maya', taskId: r.state.tasks[0]!.id, type: 'approve' }, ctx);
    expect(r.events.find((e) => e.stepId === 'teknis')!.detail).toMatchObject({
      tableRow: { tableId: 'approver_kategori', rowId: 'it' },
      assignees: ['u_irfan'],
    });
  });

  it('langkah yang dilewati dan pengalihan karena pemisahan tugas ikut tercatat', async () => {
    const v = activeVersion(definition('purchase'));
    const data = { amount: 20_000_000, category: 'atk', description: 'x' };
    let r = await startRequest(v, { id: 'r1', requesterId: 'u_fajar', data }, ctx);
    r = await act(r.state, v, { actorId: 'u_dewi', taskId: r.state.tasks[0]!.id, type: 'approve' }, ctx);
    expect(r.events.find((e) => e.action === 'step_skipped')!.stepId).toBe('teknis');
    expect(r.events.find((e) => e.stepId === 'keuangan')!.detail).toMatchObject({ reroutedToManager: true });
  });

  it('mesin hanya menghasilkan event baru; state dan event lama tidak disentuh', async () => {
    const v = activeVersion(definition('purchase'));
    const data = { amount: 20_000_000, category: 'it', description: 'Server' };
    const first = deepFreeze(await startRequest(v, { id: 'r1', requesterId: 'u_budi', data }, ctx));
    const second = await act(
      first.state,
      v,
      { actorId: 'u_maya', taskId: first.state.tasks[0]!.id, type: 'approve' },
      ctx,
    );
    expect(first.state.tasks).toHaveLength(1);
    expect(second.events.some((e) => first.events.includes(e))).toBe(false);
  });

  it('aksi yang ditolak tidak menghasilkan event', async () => {
    const v = activeVersion(definition('purchase'));
    const data = { amount: 20_000_000, category: 'it', description: 'Server' };
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data }, ctx);
    await expect(
      act(state, v, { actorId: 'u_budi', taskId: state.tasks[0]!.id, type: 'approve' }, ctx),
    ).rejects.toThrow();
    expect(state.tasks[0]!.status).toBe('open');
  });
});
