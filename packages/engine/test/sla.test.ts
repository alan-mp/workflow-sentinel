import { describe, expect, it } from 'vitest';
import { checkSla, startRequest } from '../src/index';
import { NOW, activeVersion, ctx, definition } from './helpers';

const later = (hours: number) => ({ ...ctx, now: new Date(NOW.getTime() + hours * 3_600_000) });

describe('SLA', () => {
  it('pengingat setelah tenggat, eskalasi ke atasan approver setelah dua kali SLA', async () => {
    const v = activeVersion(definition('purchase'));
    const data = { amount: 1_000_000, category: 'atk', description: 'x' };
    let { state } = await startRequest(v, { id: 'r1', requesterId: 'u_budi', data }, ctx);

    let r = await checkSla(state, v, later(23));
    expect(r.events).toEqual([]);

    r = await checkSla(state, v, later(25));
    expect(r.events.map((e) => e.action)).toEqual(['sla_reminder']);
    state = r.state;

    r = await checkSla(state, v, later(30));
    expect(r.events).toEqual([]);

    r = await checkSla(state, v, later(48));
    expect(r.events.map((e) => e.action)).toEqual(['sla_escalated']);
    expect(r.state.tasks[0]!.assignees).toEqual(['u_maya', 'u_putra']);

    expect((await checkSla(r.state, v, later(100))).events).toEqual([]);
  });

  it('eskalasi tidak pernah menambahkan pemohon sebagai approver', async () => {
    const v = activeVersion(definition('purchase'));
    // Maya memohon; langkah teknis (mesin) ke Putra, atasan Putra adalah Dewi.
    const data = { amount: 1_000_000, category: 'atk', description: 'x' };
    const { state } = await startRequest(v, { id: 'r1', requesterId: 'u_fajar', data }, ctx);
    state.tasks[0]!.assignees = ['u_pandu']; // atasan Pandu adalah Fajar, si pemohon
    const r = await checkSla(state, v, later(48));
    // Eskalasi melewati pemohon dan naik ke atasan berikutnya.
    expect(r.state.tasks[0]!.assignees).toEqual(['u_pandu', 'u_dewi']);
    expect(r.state.tasks[0]!.assignees).not.toContain('u_fajar');
  });
});
