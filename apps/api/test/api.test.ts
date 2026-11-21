import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiDrafter, DraftTurnInput } from '../src/ai';
import { runSla } from '../src/requests';
import { ConflictError, commit, loadRequest } from '../src/store';
import { setup } from './setup';

let t: Awaited<ReturnType<typeof setup>>;
const seen: DraftTurnInput[] = [];
const SOP = 'Pasal 3. Pembelian di atas Rp 25.000.000 wajib disetujui Finance Manager.\nPasal 4. Semua pembelian disetujui atasan langsung.';

/** Pengganti Claude: mengusulkan draf dengan satu kutipan asli dan satu kutipan karangan. */
const fakeDrafter: AiDrafter = {
  async run(input) {
    seen.push(input);
    if (input.message.includes('ambigu')) return { reply: '1. Batas nominalnya Rp 25 juta atau Rp 50 juta?' };
    const definition = structuredClone(input.definition);
    definition.name = 'Pembelian (draf AI)';
    return {
      reply: 'Draf disusun dari Pasal 3 dan 4.',
      draft: {
        definition,
        citations: [
          { target: 'atasan', quote: 'Semua pembelian disetujui   atasan langsung.', section: 'Pasal 4', source: 'sop' },
          { target: 'keuangan', quote: 'Direktur menyetujui semuanya', source: 'sop' },
        ],
      },
    };
  },
};

beforeAll(async () => {
  t = await setup(fakeDrafter);
}, 60_000);
afterAll(() => t.dispose());

const purchase = (amount: number, category = 'atk') => ({ flowKey: 'purchase', data: { amount, category, description: 'Uji' } });
const openTask = async (user: string, requestId: string) =>
  (await t.call(user, 'GET', '/inbox')).body.find((x: any) => x.requestId === requestId);
const decide = async (user: string, requestId: string, type = 'approve', extra = {}) => {
  const task = await openTask(user, requestId);
  const detail = (await t.call(user, 'GET', `/requests/${requestId}`)).body;
  const taskId = task?.taskId ?? detail.tasks?.find((x: any) => x.status === 'open')?.id;
  return t.call(user, 'POST', `/requests/${requestId}/decision`, { taskId, type, ...extra });
};

describe('login', () => {
  it('menolak tanpa sesi dan password salah', async () => {
    expect((await t.call(null, 'GET', '/inbox')).status).toBe(401);
    const res = await t.call(null, 'POST', '/login', { email: 'budi@contoh.test', password: 'salah' });
    expect(res.status).toBe(401);
  });
});

describe('audit trail di database', () => {
  it('baris audit tidak bisa diubah atau dihapus', async () => {
    await expect(t.env.DB.prepare("UPDATE audit_events SET action = 'x'").run()).rejects.toThrow(/hanya bisa ditambah/);
    await expect(t.env.DB.prepare('DELETE FROM audit_events').run()).rejects.toThrow(/hanya bisa ditambah/);
  });

  it('versi alur yang aktif tidak bisa diubah atau dihapus', async () => {
    await expect(
      t.env.DB.prepare("UPDATE flow_versions SET definition = '{}' WHERE id = 'purchase-v1'").run(),
    ).rejects.toThrow(/tidak bisa diubah/);
    await expect(t.env.DB.prepare("DELETE FROM flow_versions WHERE id = 'purchase-v1'").run()).rejects.toThrow(/tidak bisa dihapus/);
  });
});

describe('siklus permintaan pembelian', () => {
  let id: string;

  it('pemohon mengirim, approver melihatnya di kotak masuk', async () => {
    const res = await t.call('budi', 'POST', '/requests', purchase(30_000_000, 'it'));
    expect(res.status).toBe(201);
    id = res.body.id;
    expect(await openTask('maya', id)).toMatchObject({ stepName: 'Atasan langsung', flowName: 'Permintaan Pembelian' });
    expect(await openTask('fajar', id)).toBeUndefined();
  });

  it('orang di luar permintaan tidak bisa melihat isinya', async () => {
    expect((await t.call('hana', 'GET', `/requests/${id}`)).status).toBe(404);
    expect((await t.call('maya', 'GET', `/requests/${id}`)).status).toBe(200);
  });

  it('pemohon tidak bisa memutuskan permintaannya sendiri', async () => {
    const res = await decide('budi', id);
    expect(res).toMatchObject({ status: 403, body: { code: 'SOD_VIOLATION' } });
  });

  it('lampiran tersimpan dan hanya bisa diunduh pihak terkait', async () => {
    const form = new FormData();
    form.append('file', new File(['penawaran harga'], 'penawaran.txt', { type: 'text/plain' }));
    const up = await t.call('budi', 'POST', `/requests/${id}/attachments`, form);
    expect(up.status).toBe(201);
    expect((await t.call('maya', 'GET', `/attachments/${up.body.id}`)).body).toBe('penawaran harga');
    expect((await t.call('hana', 'GET', `/attachments/${up.body.id}`)).status).toBe(404);
  });

  it('berjalan berurutan lalu paralel sampai disetujui, lalu dikirim ke ERP lewat adapter', async () => {
    expect((await decide('maya', id, 'approve', { comment: 'Sesuai kebutuhan' })).status).toBe(200);
    expect(await openTask('fajar', id)).toBeTruthy();
    expect(await openTask('irfan', id)).toBeTruthy();
    await decide('fajar', id);
    expect((await t.call('budi', 'GET', `/requests/${id}`)).body.status).toBe('in_progress');
    expect((await decide('irfan', id)).body.status).toBe('approved');

    const detail = (await t.call('budi', 'GET', `/requests/${id}`)).body;
    const actions = detail.timeline.map((e: any) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['request_submitted', 'task_approved', 'request_approved', 'erp_synced']));
    expect(detail.timeline.every((e: any) => e.at && e.actorType)).toBe(true);
    const { results } = await t.env.DB.prepare('SELECT DISTINCT flow_version_id FROM audit_events WHERE request_id = ?').bind(id).all();
    expect(results).toEqual([{ flow_version_id: 'purchase-v1' }]);
    expect(detail.tasks.every((x: any) => x.createdAt && x.actedAt)).toBe(true);
  });

  it('notifikasi sampai ke approver, pemohon, dan penerima langkah notifikasi', async () => {
    const of = async (u: string) => (await t.call(u, 'GET', '/notifications')).body.map((n: any) => n.message).join('\n');
    expect(await of('maya')).toMatch(/menunggu persetujuan Anda/);
    expect(await of('budi')).toMatch(/disetujui/);
    expect(await of('pandu')).toMatch(/Permintaan pembelian disetujui/);
  });

  it('minta revisi lalu kirim ulang; tolak menghentikan permintaan', async () => {
    const r = (await t.call('budi', 'POST', '/requests', purchase(1_000_000))).body.id;
    expect((await decide('maya', r, 'request_revision', { comment: 'Lengkapi' })).body.status).toBe('revision_requested');
    expect((await t.call('maya', 'POST', `/requests/${r}/resubmit`, purchase(1).data)).status).toBe(404);
    expect((await t.call('budi', 'POST', `/requests/${r}/resubmit`, { data: purchase(2_000_000).data })).status).toBe(200);
    expect((await decide('maya', r, 'reject')).body.status).toBe('rejected');
  });

  it('perubahan bersamaan pada permintaan yang sama ditolak, tanpa jejak audit palsu', async () => {
    const r = (await t.call('budi', 'POST', '/requests', purchase(1_000_000))).body.id;
    const loaded = (await loadRequest(t.env.DB, r))!;
    const before = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM audit_events').first<{ n: number }>();
    const event = { at: 'x', actor: { type: 'system' as const }, action: 'palsu', flowVersionId: 'purchase-v1', requestId: r };
    await expect(
      commit(t.env.DB, { state: loaded.state, prevRev: loaded.rev + 5, events: [event], notices: [], now: new Date() }),
    ).rejects.toBeInstanceOf(ConflictError);
    const after = await t.env.DB.prepare('SELECT COUNT(*) AS n FROM audit_events').first<{ n: number }>();
    expect(after!.n).toBe(before!.n);
  });
});

describe('delegasi', () => {
  it('delegasi wajib berbatas waktu', async () => {
    const res = await t.call('maya', 'POST', '/delegations', { toUserId: 'u_putra', startsAt: new Date().toISOString(), endsAt: '' });
    expect(res.status).toBe(400);
  });

  it('penerima delegasi bisa memutuskan atas nama pemberi', async () => {
    const now = Date.now();
    await t.call('maya', 'POST', '/delegations', {
      toUserId: 'u_putra',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
    });
    const r = (await t.call('budi', 'POST', '/requests', purchase(1_000_000))).body.id;
    expect(await openTask('putra', r)).toMatchObject({ onBehalfOf: 'u_maya' });
    expect((await decide('putra', r)).body.status).toBe('approved');
    const detail = (await t.call('budi', 'GET', `/requests/${r}`)).body;
    expect(detail.tasks[0]).toMatchObject({ actedBy: 'u_putra', onBehalfOf: 'u_maya' });
  });

  it('pemohon tidak bisa menyetujui lewat delegasi dari atasannya', async () => {
    const now = Date.now();
    await t.call('maya', 'POST', '/delegations', {
      toUserId: 'u_budi',
      startsAt: new Date(now - 60_000).toISOString(),
      endsAt: new Date(now + 3_600_000).toISOString(),
    });
    const r = (await t.call('budi', 'POST', '/requests', purchase(1_000_000))).body.id;
    expect(await openTask('budi', r)).toBeUndefined();
    expect((await decide('budi', r)).body.code).toBe('SOD_VIOLATION');
  });

  it('atasan langsung bisa mendelegasikan atas nama bawahan yang berhalangan; orang lain tidak', async () => {
    const now = Date.now();
    const body = { fromUserId: 'u_maya', toUserId: 'u_irfan', startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString() };
    expect((await t.call('budi', 'POST', '/delegations', body)).status).toBe(403);
    expect((await t.call('hana', 'POST', '/delegations', body)).status).toBe(403);
    const made = await t.call('putra', 'POST', '/delegations', body);
    expect(made.status).toBe(201);

    const notes = (await t.call('maya', 'GET', '/notifications')).body.map((n: any) => n.message).join('\n');
    expect(notes).toMatch(/Putra.*mendelegasikan approval Anda ke Irfan/);
    expect((await t.call('maya', 'GET', '/delegations')).body.find((d: any) => d.id === made.body.id)).toMatchObject({ created_by: 'u_putra' });

    const r = (await t.call('hadi', 'POST', '/requests', { flowKey: 'leave', data: { leave_type: 'sakit', start_date: '2026-12-10', end_date: '2026-12-11', days: 1 } })).body.id;
    // Atasan Hadi adalah Irfan sendiri, jadi pakai permintaan Budi untuk menguji delegasi Maya.
    await decide('irfan', r);
    const viaMaya = (await t.call('budi', 'POST', '/requests', purchase(1_000_000))).body.id;
    expect(await openTask('irfan', viaMaya)).toMatchObject({ onBehalfOf: 'u_maya' });
    await decide('irfan', viaMaya);
    const audit = await t.env.DB.prepare("SELECT detail FROM audit_events WHERE request_id = ? AND action = 'task_approved'").bind(viaMaya).first<any>();
    expect(JSON.parse(audit.detail)).toMatchObject({ onBehalfOf: 'u_maya', delegatedBy: 'u_putra' });

    expect((await t.call('putra', 'DELETE', `/delegations/${made.body.id}`)).status).toBe(200);
    expect((await t.call('maya', 'GET', '/delegations')).body.some((d: any) => d.id === made.body.id)).toBe(false);
  });
});

describe('SLA', () => {
  it('cron mengirim pengingat lalu eskalasi, masing-masing sekali', async () => {
    const r = (await t.call('hadi', 'POST', '/requests', purchase(1_000_000))).body.id;
    const hours = (h: number) => new Date(Date.now() + h * 3_600_000);
    const actions = async () =>
      (await t.env.DB.prepare("SELECT action FROM audit_events WHERE request_id = ? AND action LIKE 'sla_%' ORDER BY seq").bind(r).all())
        .results.map((x) => x.action);

    await runSla(t.env.DB, t.deps, hours(1));
    expect(await actions()).toEqual([]);
    await runSla(t.env.DB, t.deps, hours(25));
    await runSla(t.env.DB, t.deps, hours(26));
    expect(await actions()).toEqual(['sla_reminder']);
    await runSla(t.env.DB, t.deps, hours(49));
    expect(await actions()).toEqual(['sla_reminder', 'sla_escalated']);
    // Atasan Irfan (approver) adalah Dewi; kini ia juga bisa memutuskan.
    expect(await openTask('dewi', r)).toBeTruthy();
  });
});

describe('membuat dan mengaktifkan alur', () => {
  let draftId: string;

  it('hanya admin yang bisa membuka area admin', async () => {
    expect((await t.call('budi', 'GET', '/admin/versions')).status).toBe(403);
  });

  it('admin membuat draf dari versi aktif dan mengunggah SOP', async () => {
    const res = await t.call('hana', 'POST', '/admin/drafts', { flowKey: 'purchase' });
    draftId = res.body.id;
    expect((await t.call('hana', 'POST', `/admin/drafts/${draftId}/sop`, { name: 'SOP Pembelian', content: SOP })).status).toBe(201);
    const draft = (await t.call('hana', 'GET', `/admin/versions/${draftId}`)).body;
    expect(draft).toMatchObject({ status: 'draft', version: 2, sop: { name: 'SOP Pembelian' } });
  });

  it('AI bertanya kalau SOP ambigu dan tidak mengubah draf', async () => {
    const res = await t.call('hana', 'POST', `/admin/drafts/${draftId}/chat`, { message: 'Bagian ini ambigu' });
    expect(res.body).toMatchObject({ updated: false });
    expect(res.body.reply).toMatch(/Rp 25 juta atau Rp 50 juta/);
    expect((await t.call('hana', 'GET', `/admin/versions/${draftId}`)).body.definition.name).toBe('Permintaan Pembelian');
  });

  it('draf dari chat tersimpan dengan kutipan; kutipan yang tidak ada di SOP ditandai', async () => {
    const res = await t.call('hana', 'POST', `/admin/drafts/${draftId}/chat`, { message: 'Susun dari SOP' });
    expect(res.body.updated).toBe(true);
    const draft = (await t.call('hana', 'GET', `/admin/versions/${draftId}`)).body;
    expect(draft.status).toBe('draft');
    expect(draft.definition.name).toBe('Pembelian (draf AI)');
    expect(draft.citations.map((q: any) => [q.target, q.verified])).toEqual([
      ['atasan', true],
      ['keuangan', false],
    ]);
    expect(draft.chat.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const audit = await t.env.DB.prepare(
      "SELECT actor_type, detail FROM audit_events WHERE flow_version_id = ? AND action = 'draft_edited'",
    ).bind(draftId).first<any>();
    expect(audit.actor_type).toBe('ai');
    expect(JSON.parse(audit.detail)).toMatchObject({ via: 'chat', onBehalfOf: 'u_hana' });
  });

  it('AI hanya menerima SOP, draf, dan nama peran, tanpa data karyawan', async () => {
    const sent = JSON.stringify(seen);
    expect(sent).toContain('finance_manager');
    expect(sent).not.toMatch(/contoh\.test|Budi|Maya|u_budi/);
  });

  it('perubahan manual di editor terlihat oleh chat berikutnya', async () => {
    const draft = (await t.call('hana', 'GET', `/admin/versions/${draftId}`)).body;
    draft.definition.steps[0].slaHours = 12;
    expect((await t.call('hana', 'PUT', `/admin/drafts/${draftId}`, { definition: draft.definition, sopUrl: draft.sopUrl })).status).toBe(200);
    await t.call('hana', 'POST', `/admin/drafts/${draftId}/chat`, { message: 'Lanjutkan' });
    expect(seen.at(-1)!.definition.steps[0]).toMatchObject({ slaHours: 12 });
  });

  it('simulasi bisa dijalankan pada definisi yang belum disimpan', async () => {
    const draft = (await t.call('hana', 'GET', `/admin/versions/${draftId}`)).body;
    const res = await t.call('hana', 'POST', '/admin/simulate', {
      definition: draft.definition,
      requesterId: 'u_budi',
      data: { amount: 150_000_000, category: 'mesin', description: 'x' },
    });
    expect(res.body.steps.filter((s: any) => s.type === 'approval').map((s: any) => s.userIds)).toEqual([
      ['u_maya'],
      ['u_fajar'],
      ['u_putra'],
      ['u_dewi'],
    ]);
  });

  it('penyusun draf tidak bisa mengaktifkan; draf tidak pernah aktif sendiri', async () => {
    const res = await t.call('hana', 'POST', `/admin/drafts/${draftId}/activate`, { effectiveFrom: new Date().toISOString() });
    expect(res).toMatchObject({ status: 403, body: { code: 'SOD_VIOLATION' } });
    expect((await t.call('hana', 'GET', `/admin/versions/${draftId}`)).body.status).toBe('draft');
  });

  it('orang kedua mengaktifkan; permintaan lama tetap di versi lama, yang baru di versi baru', async () => {
    const old = (await t.call('budi', 'POST', '/requests', purchase(1_000_000))).body.id;
    await t.call('hana', 'POST', `/admin/drafts/${draftId}/submit`);
    expect((await t.call('dewi', 'GET', '/notifications')).body.map((n: any) => n.message).join('\n')).toMatch(/menunggu tinjauan/);

    const res = await t.call('dewi', 'POST', `/admin/drafts/${draftId}/activate`, { effectiveFrom: new Date(Date.now() - 1000).toISOString() });
    expect(res.status).toBe(200);
    expect((await t.call('hana', 'PUT', `/admin/drafts/${draftId}`, { definition: {} })).status).toBe(404);

    const fresh = (await t.call('budi', 'POST', '/requests', purchase(1_000_000))).body.id;
    expect((await loadRequest(t.env.DB, old))!.state.flowVersionId).toBe('purchase-v1');
    expect((await loadRequest(t.env.DB, fresh))!.state.flowVersionId).toBe(draftId);
    expect((await t.call('budi', 'GET', '/flows')).body.find((f: any) => f.key === 'purchase').name).toBe('Pembelian (draf AI)');
  });
});

describe('direktori dari CSV', () => {
  it('impor menambah karyawan baru dengan password sementara dan memperbarui atasan', async () => {
    const csv = 'id,email,name,department,manager_id,roles,is_admin\nu_rina,rina@contoh.test,Rina,produksi,u_maya,,0\nu_budi,budi@contoh.test,Budi (Operator Produksi),produksi,u_putra,,0';
    const res = await t.call('hana', 'POST', '/admin/directory', csv);
    expect(res.body).toMatchObject({ imported: 2 });
    expect(res.body.created).toHaveLength(1);
    const login = await t.call(null, 'POST', '/login', { email: 'rina@contoh.test', password: res.body.created[0].temporaryPassword });
    expect(login.status).toBe(200);
    const r = (await t.call('budi', 'POST', '/requests', { flowKey: 'leave', data: { leave_type: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-11', days: 2 } })).body.id;
    expect(await openTask('putra', r)).toBeTruthy();
  });
});
