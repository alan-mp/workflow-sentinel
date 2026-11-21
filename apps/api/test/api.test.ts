import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AiDrafter, DraftTurnInput } from '../src/ai';
import { runCron } from '../src/cron';
import { deliverDue, sign } from '../src/integrations';
import { safeEqual } from '../src/security';
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

  it('membatasi percobaan login per email, tanpa mengganggu email lain', async () => {
    const guess = () => t.call(null, 'POST', '/login', { email: 'Tebak@Contoh.test', password: 'salah' });
    for (let i = 0; i < 10; i++) expect((await guess()).status).toBe(401);
    expect(await guess()).toMatchObject({ status: 429, body: { error: expect.stringMatching(/Too many sign-in attempts/) } });
    // Same email in another case counts toward the same limit.
    expect((await t.call(null, 'POST', '/login', { email: 'tebak@contoh.test', password: 'salah' })).status).toBe(429);
    expect((await t.call(null, 'POST', '/login', { email: 'budi@contoh.test', password: 'salah' })).status).toBe(401);
  });

  it('membandingkan rahasia tanpa bocor lewat panjang', async () => {
    expect(await safeEqual('token-a', 'token-a')).toBe(true);
    expect(await safeEqual('token-a', 'token-b')).toBe(false);
    expect(await safeEqual('token', 'token-lebih-panjang')).toBe(false);
    expect(await safeEqual('', '')).toBe(true);
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
    const stored = await t.env.FILES.head(`attachments/${up.body.id}`);
    expect(stored?.httpMetadata?.contentType).toBe('text/plain');
  });

  it('lampiran di atas 10 MB ditolak, yang besar menurut Content-Length sebelum isinya dibaca', async () => {
    const init = await t.prepare('budi', 'POST', 'x');
    const declared = await t.request(`/api/requests/${id}/attachments`, {
      ...init,
      headers: { ...(init.headers as Record<string, string>), 'content-length': String(20 * 1024 * 1024) },
    });
    expect(declared.status).toBe(413);

    const form = new FormData();
    form.append('file', new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'besar.bin'));
    expect(await t.call('budi', 'POST', `/requests/${id}/attachments`, form)).toMatchObject({ status: 413, body: { error: expect.stringMatching(/at most 10 MB/) } });
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
    expect(await of('maya')).toMatch(/is awaiting your approval/);
    expect(await of('budi')).toMatch(/was approved\./);
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
    expect((await t.call('maya', 'GET', '/reports')).body.map((u: any) => u.id)).toContain('u_budi');
    expect((await t.call('putra', 'GET', '/reports')).body.map((u: any) => u.id)).toEqual(['u_maya']);
    expect((await t.call('budi', 'POST', '/delegations', body)).status).toBe(403);
    expect((await t.call('hana', 'POST', '/delegations', body)).status).toBe(403);
    const made = await t.call('putra', 'POST', '/delegations', body);
    expect(made.status).toBe(201);

    const notes = (await t.call('maya', 'GET', '/notifications')).body.map((n: any) => n.message).join('\n');
    expect(notes).toMatch(/Putra.*delegated your approvals to Irfan/);
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

  it('karyawan biasa tidak bisa membuka area pengelolaan alur', async () => {
    expect((await t.call('budi', 'GET', '/admin/flows')).status).toBe(403);
  });

  it('pemilik proses hanya melihat dan mengubah alur miliknya', async () => {
    const irfan = (await t.call('irfan', 'GET', '/admin/flows')).body;
    expect(irfan.map((f: any) => f.key)).toEqual(['it_access']);
    expect((await t.call('irfan', 'POST', '/admin/drafts', { flowKey: 'purchase' })).status).toBe(403);
    expect((await t.call('irfan', 'GET', '/admin/versions/purchase-v1')).status).toBe(404);
  });

  it('admin sistem bisa menyusun dan mengaktifkan sendiri; pengecualian itu tercatat di audit', async () => {
    const all = (await t.call('hadi', 'GET', '/admin/flows')).body;
    expect(all.map((f: any) => [f.key, f.canEdit])).toEqual([['it_access', true], ['leave', true], ['purchase', true]]);
    const made = await t.call('hadi', 'POST', '/admin/drafts', { flowKey: 'vendor', name: 'Vendor' });
    expect(made.status).toBe(201);
    const draft = (await t.call('hadi', 'GET', `/admin/versions/${made.body.id}`)).body;
    expect(draft).toMatchObject({ canEdit: true, canActivate: true });
    expect((await t.call('hadi', 'PUT', `/admin/drafts/${made.body.id}`, { definition: draft.definition, sopUrl: 'https://contoh.test/sop-vendor' })).status).toBe(200);
    const res = await t.call('hadi', 'POST', `/admin/drafts/${made.body.id}/activate`, { effectiveFrom: new Date().toISOString() });
    expect(res.status).toBe(200);
    const audit = await t.env.DB.prepare("SELECT detail FROM audit_events WHERE action = 'version_activated' AND flow_version_id = ?").bind(made.body.id).first<any>();
    expect(JSON.parse(audit.detail)).toMatchObject({ adminOverride: true, editedBy: ['u_hadi'] });
  });

  it('admin sistem menunjuk pemilik: minimal dua, dan hanya dia yang boleh', async () => {
    const put = (who: string, userIds: string[]) => t.call(who, 'PUT', '/admin/flows/reimburse/owners', { userIds });
    expect((await put('hana', ['u_hana', 'u_fajar'])).status).toBe(403);
    expect((await put('hadi', ['u_fajar'])).status).toBe(400);
    expect((await put('hadi', ['u_fajar', 'u_pandu'])).status).toBe(200);
    expect((await t.call('fajar', 'GET', '/me')).body.ownedFlows).toEqual(['reimburse']);
    const made = await t.call('fajar', 'POST', '/admin/drafts', { flowKey: 'reimburse', name: 'Reimburse' });
    expect(made.status).toBe(201);
    const audit = await t.env.DB.prepare("SELECT actor_id, detail FROM audit_events WHERE action = 'owners_assigned'").first<any>();
    expect(audit).toMatchObject({ actor_id: 'u_hadi' });
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
    expect((await t.call('dewi', 'GET', '/notifications')).body.map((n: any) => n.message).join('\n')).toMatch(/is awaiting your review/);

    const body = { effectiveFrom: new Date().toISOString() };
    expect((await t.call('irfan', 'POST', `/admin/drafts/${draftId}/activate`, body)).status).toBe(403);
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
  it('impor menambah karyawan dengan password sementara; atasan mengikuti unit, bukan kolom per orang', async () => {
    const csv = 'id,email,name,unit_id,title,is_admin\nu_rina,rina@contoh.test,Rina,produksi_line,Operator,0\nu_budi,budi@contoh.test,Budi (Operator Produksi),produksi,Operator,0';
    expect((await t.call('hana', 'POST', '/admin/directory', csv)).status).toBe(403);
    expect((await t.call('hadi', 'POST', '/admin/directory', 'id,email,name,unit_id\nu_x,x@contoh.test,X,tidak_ada')).status).toBe(400);
    const res = await t.call('hadi', 'POST', '/admin/directory', csv);
    expect(res.body).toMatchObject({ imported: 2 });
    expect(res.body.created).toHaveLength(1);
    const login = await t.call(null, 'POST', '/login', { email: 'rina@contoh.test', password: res.body.created[0].temporaryPassword });
    expect(login.status).toBe(200);
    const leave = { flowKey: 'leave', data: { leave_type: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-11', days: 2 } };
    // Budi kini langsung di unit Produksi: atasannya kepala Produksi. Rina di Produksi Line: atasannya kepala seksi.
    const budi = (await t.call('budi', 'POST', '/requests', leave)).body.id;
    const detail = (await t.call('budi', 'GET', `/requests/${budi}`)).body;
    expect(detail.tasks[0]).toMatchObject({ assignees: ['u_putra'], basis: 'head of Produksi' });
    // Dikembalikan ke seksinya: permintaan berikutnya kembali ke kepala seksi.
    await t.call('hadi', 'POST', '/admin/directory', 'id,email,name,unit_id,title\nu_budi,budi@contoh.test,Budi (Operator Produksi),produksi_line,Operator');
    const back = (await t.call('budi', 'POST', '/requests', leave)).body.id;
    expect((await t.call('budi', 'GET', `/requests/${back}`)).body.tasks[0].assignees).toEqual(['u_maya']);
  });
});

describe('master organisasi', () => {
  const propose = (user: string, change: object, extra: object = {}) => t.call(user, 'POST', '/org/changes', { change, ...extra });
  const review = (user: string, id: string, decision = 'approve') => t.call(user, 'POST', `/org/changes/${id}/review`, { decision });
  const org = async () => (await t.call('hana', 'GET', '/org')).body;

  it('hanya pemilik organisasi yang mengusulkan; karyawan biasa tidak bisa melihat master', async () => {
    expect((await t.call('budi', 'GET', '/org')).status).toBe(403);
    expect((await org()).canEdit).toBe(true);
    expect((await t.call('irfan', 'GET', '/org')).body.canEdit).toBe(false);
    expect((await propose('irfan', { kind: 'unit_head', id: 'produksi_line', headUserId: null })).status).toBe(403);
    expect((await t.call('hadi', 'PUT', '/org/owners', { userIds: ['u_hana'] })).status).toBe(400);
  });

  it('usulan yang tidak sah ditolak dengan alasannya', async () => {
    const bad = async (change: object) => (await propose('hana', change)).body.error as string;
    expect(await bad({ kind: 'unit_head', id: 'produksi_line', headUserId: 'u_fajar' })).toMatch(/is not placed/);
    expect(await bad({ kind: 'unit_upsert', id: 'direksi', name: 'Direksi', level: 'direksi', parentId: 'produksi' })).toMatch(/must be below its parent/);
    expect(await bad({ kind: 'unit_delete', id: 'produksi' })).toMatch(/still has units/);
    expect(await bad({ kind: 'user_place', userId: 'u_maya', unitId: 'it' })).toMatch(/is still head of Produksi Line/);
    expect(await bad({ kind: 'unit_head', id: 'hr', actingHeadUserId: 'u_sari' })).toMatch(/An acting head can be set only when there is no permanent head|needs an end date/);
    expect(await bad({ kind: 'exception_add', userId: 'u_budi', toUserId: 'u_irfan', reason: '', startsAt: '2026-12-01', endsAt: '2027-01-01' })).toMatch(/reason for the reporting exception is required/);
    expect(await bad({ kind: 'exception_add', userId: 'u_budi', toUserId: 'u_irfan', reason: 'x', startsAt: '2026-01-01', endsAt: '2028-01-01' })).toMatch(/one year/);
    expect(await bad({ kind: 'authority_delete', id: 'finance_manager' })).toMatch(/still used by flow/);
  });

  it('usulan ditinjau orang kedua; setelah berlaku, tugas terbuka pindah mengikuti struktur dan tercatat', async () => {
    const leave = { flowKey: 'leave', data: { leave_type: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-11', days: 2 } };
    const id = (await t.call('budi', 'POST', '/requests', leave)).body.id;
    expect(await openTask('maya', id)).toBeTruthy();

    // Kosongkan kepala seksi: muncul temuan baru, dan tugas Maya naik ke kepala Produksi.
    const res = await propose('hana', { kind: 'unit_head', id: 'produksi_line', headUserId: null }, { note: 'Maya dimutasi' });
    expect(res.status).toBe(201);
    expect(res.body.impact).toEqual([expect.objectContaining({ type: 'baru', message: expect.stringMatching(/Produksi Line: no head/) })]);
    expect((await review('hana', res.body.id)).status).toBe(403);
    const applied = (await review('dewi', res.body.id)).body;
    expect(applied.status).toBe('applied');
    // Semua tugas terbuka milik Maya sebagai kepala seksi ikut pindah, termasuk dari tes sebelumnya.
    expect(applied.movedTasks).toBeGreaterThanOrEqual(1);
    expect(await openTask('maya', id)).toBeUndefined();
    expect(await openTask('putra', id)).toBeTruthy();
    const detail = (await t.call('budi', 'GET', `/requests/${id}`)).body;
    expect(detail.tasks[0].basis).toMatch(/head of Produksi; escalated because head of Produksi Line is vacant/);
    expect(detail.timeline.map((e: any) => e.action)).toContain('task_reassigned');
    expect((await org()).findings.map((f: any) => f.code)).toContain('UNIT_NO_HEAD');
    expect((await review('dewi', res.body.id)).status).toBe(404);
  });

  it('usulan bertanggal berlaku ke depan dijadwalkan dan diterapkan cron', async () => {
    const later = new Date(Date.now() + 3_600_000).toISOString();
    const res = await propose('dewi', { kind: 'unit_head', id: 'produksi_line', headUserId: 'u_maya' }, { effectiveFrom: later });
    expect((await review('hana', res.body.id)).body).toMatchObject({ status: 'scheduled' });
    const { applyDueChanges } = await import('../src/org');
    expect(await applyDueChanges(t.env.DB, t.deps, new Date())).toBe(0);
    expect(await applyDueChanges(t.env.DB, t.deps, new Date(Date.now() + 7_200_000))).toBe(1);
    expect((await org()).units.find((u: any) => u.id === 'produksi_line').headUserId).toBe('u_maya');
  });

  it('pengecualian pelaporan dan wewenang bercakupan mengubah routing setelah ditinjau', async () => {
    const start = new Date(Date.now() - 60_000).toISOString();
    const end = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const ex = await propose('hana', { kind: 'exception_add', userId: 'u_budi', toUserId: 'u_irfan', flowKey: 'leave', reason: 'Diperbantukan ke proyek ERP', startsAt: start, endsAt: end });
    expect((await review('dewi', ex.body.id)).body.status).toBe('applied');
    const leave = { flowKey: 'leave', data: { leave_type: 'tahunan', start_date: '2026-12-10', end_date: '2026-12-11', days: 2 } };
    const id = (await t.call('budi', 'POST', '/requests', leave)).body.id;
    const task = (await t.call('budi', 'GET', `/requests/${id}`)).body.tasks[0];
    expect(task).toMatchObject({ assignees: ['u_irfan'], basis: 'reporting exception: Diperbantukan ke proyek ERP' });

    const add = await propose('hana', { kind: 'holder_add', authorityId: 'finance_manager', userId: 'u_pandu', scopeUnitId: 'it' });
    expect((await review('dewi', add.body.id)).body.status).toBe('applied');
    const holders = (await org()).holders.finance_manager;
    expect(holders).toEqual(expect.arrayContaining([{ userId: 'u_fajar' }, { userId: 'u_pandu', scopeUnitId: 'it' }]));
  });

  it('usulan admin sistem langsung berlaku tanpa peninjau kedua dan ditandai di audit', async () => {
    const res = await propose('hadi', { kind: 'authority_upsert', id: 'legal', name: 'Persetujuan legal' });
    expect(res.body).toMatchObject({ status: 'applied' });
    expect((await org()).authorities.map((a: any) => a.id)).toContain('legal');
    const audit = await t.env.DB.prepare("SELECT actor_id, detail FROM audit_events WHERE action = 'org_change_admin_override'").first<any>();
    expect(audit.actor_id).toBe('u_hadi');
    expect(JSON.parse(audit.detail)).toMatchObject({ changeId: res.body.id, adminOverride: true });
  });

  it('uji cakupan melaporkan orang yang jalur approval-nya buntu', async () => {
    const res = (await t.call('hana', 'GET', '/org/coverage')).body;
    const leave = res.flows.find((f: any) => f.key === 'leave');
    // Direktur tidak punya atasan, jadi cuti-nya tidak punya jalur.
    expect(leave.gaps.map((g: any) => g.userId)).toContain('u_dewi');
    expect(leave.gaps.map((g: any) => g.userId)).not.toContain('u_budi');
    expect(leave.blocked).toBeGreaterThanOrEqual(1);
  });
});

describe('integrasi: API masuk dan webhook keluar', () => {
  const sent: { url: string; headers: Record<string, string>; body: string }[] = [];
  let failing = false;
  let apiKey: string;
  let signingSecret: string;
  let hookSecret: string;
  /** Panggilan dari sistem lain: kunci API di header, tanpa sesi pengguna. */
  const api = async (key: string | null, method: string, url: string, body?: unknown) => {
    const res = await t.request(`/api/integrations${url}`, { method, headers: key ? { authorization: `Bearer ${key}` } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: (await res.json()) as any };
  };

  beforeAll(() => {
    t.deps.http = (async (url: any, init: any) => {
      if (failing) return new Response('down', { status: 503 });
      sent.push({ url: String(url), headers: init.headers, body: init.body });
      return new Response('ok');
    }) as typeof fetch;
  });

  it('hanya admin sistem yang mengelola integrasi; kunci tampil sekali dan hanya hash yang disimpan', async () => {
    expect((await t.call('budi', 'GET', '/admin/integrations')).status).toBe(403);
    expect((await t.call('hadi', 'POST', '/admin/integrations/webhooks', { url: 'http://tidak-aman.test/x' })).status).toBe(400);
    const client = await t.call('hadi', 'POST', '/admin/integrations/clients', { name: 'Aplikasi HR', callbackHosts: ['hr.contoh.test'] });
    expect(client.status).toBe(201);
    ({ apiKey, signingSecret } = client.body);
    const hook = await t.call('hadi', 'POST', '/admin/integrations/webhooks', { url: 'https://erp.contoh.test/hook', flowKey: 'purchase' });
    hookSecret = hook.body.secret;
    const list = (await t.call('hadi', 'GET', '/admin/integrations')).body;
    expect(JSON.stringify(list)).not.toContain(apiKey);
    expect(JSON.stringify(list)).not.toContain(hookSecret);
    const stored = await t.env.DB.prepare('SELECT key_hash FROM api_clients').first<any>();
    expect(stored.key_hash).not.toContain(apiKey.slice(-20));
  });

  it('menolak tanpa kunci, callback di luar daftar, dan email yang tidak dikenal', async () => {
    const body = { flowKey: 'purchase', requesterEmail: 'budi@contoh.test', data: { amount: 1_000_000, category: 'atk', description: 'Dari HR' } };
    expect((await api(null, 'POST', '/requests', body)).status).toBe(401);
    expect((await api('sk_sentinel_salah', 'POST', '/requests', body)).status).toBe(401);
    expect((await api(apiKey, 'POST', '/requests', { ...body, callbackUrl: 'https://jahat.test/x' })).status).toBe(400);
    expect((await api(apiKey, 'POST', '/requests', { ...body, requesterEmail: 'tidak.ada@contoh.test' })).status).toBe(422);
    expect((await api(apiKey, 'POST', '/requests', { ...body, data: {} })).status).toBe(400);
  });

  it('pengajuan lewat API mengikuti alur yang sama, idempoten, dan hasil akhirnya dikirim bertanda tangan', async () => {
    const body = {
      flowKey: 'purchase',
      requesterEmail: 'budi@contoh.test',
      data: { amount: 1_000_000, category: 'atk', description: 'Dari HR' },
      externalRef: 'HR-001',
      callbackUrl: 'https://hr.contoh.test/approval-done',
    };
    const created = await api(apiKey, 'POST', '/requests', body);
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await api(apiKey, 'POST', '/requests', body)).body).toMatchObject({ id, duplicate: true });
    // Approver yang sama dengan pengajuan lewat aplikasi: atasan langsung pemohon.
    expect(await openTask('maya', id)).toMatchObject({ stepName: 'Atasan langsung' });
    expect((await api(apiKey, 'GET', `/requests/${id}`)).body).toMatchObject({ status: 'in_progress', externalRef: 'HR-001' });
    expect(sent).toHaveLength(0);

    expect((await decide('maya', id, 'reject', { comment: 'Anggaran habis' })).status).toBe(200);
    expect((await api(apiKey, 'GET', `/requests/${id}`)).body.status).toBe('rejected');
    expect(sent.map((s) => s.url).sort()).toEqual(['https://erp.contoh.test/hook', 'https://hr.contoh.test/approval-done']);
    for (const s of sent) {
      const payload = JSON.parse(s.body);
      expect(payload).toMatchObject({ event: 'request.rejected', request: { id, status: 'rejected', externalRef: 'HR-001', requesterEmail: 'budi@contoh.test' } });
      const [, ts, mac] = /^t=(\d+),v1=([0-9a-f]+)$/.exec(s.headers['x-sentinel-signature']!)!;
      const secret = s.url.includes('hr.contoh') ? signingSecret : hookSecret;
      expect(mac).toBe(await sign(secret, Number(ts), s.body));
    }
    const actions = (await t.env.DB.prepare('SELECT action FROM audit_events WHERE request_id = ?').bind(id).all<any>()).results.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['request_submitted_via_api', 'webhook_delivered']));
  });

  it('webhook yang gagal dicoba ulang oleh cron, dan kunci yang dicabut berhenti bekerja', async () => {
    sent.length = 0;
    failing = true;
    const id = (await t.call('budi', 'POST', '/requests', purchase(2_000_000))).body.id;
    expect((await decide('maya', id, 'reject', { comment: 'Tidak perlu' })).status).toBe(200);
    const pending = (await t.call('hadi', 'GET', '/admin/integrations/deliveries?status=pending')).body;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ requestId: id, attempts: 1, lastError: 'HTTP 503' });

    failing = false;
    expect(await deliverDue(t.env.DB, t.deps, new Date())).toBe(0); // belum waktunya
    expect(await deliverDue(t.env.DB, t.deps, new Date(Date.now() + 2 * 60_000))).toBe(1);
    expect(sent).toHaveLength(1);
    expect((await t.call('hadi', 'GET', '/admin/integrations/deliveries?status=pending')).body).toHaveLength(0);

    const clientId = (await t.call('hadi', 'GET', '/admin/integrations')).body.clients[0].id;
    expect((await t.call('hadi', 'DELETE', `/admin/integrations/clients/${clientId}`)).status).toBe(200);
    expect((await api(apiKey, 'GET', '/flows')).status).toBe(401);
  });

  it('keputusan dijawab sebelum webhook terkirim; pengiriman berjalan lewat waitUntil', async () => {
    sent.length = 0;
    const id = (await t.call('budi', 'POST', '/requests', purchase(3_000_000))).body.id;
    const task = await openTask('maya', id);
    const http = t.deps.http;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    t.deps.http = (async (url: any, init: any) => {
      await gate;
      return http!(url, init);
    }) as typeof fetch;
    try {
      // If delivery were awaited inside the request, this would not return while the gate is closed.
      const { res, settle, pending } = await t.send(`/api/requests/${id}/decision`, await t.prepare('maya', 'POST', { taskId: task.taskId, type: 'reject', comment: 'Tidak perlu' }));
      expect(res.status).toBe(200);
      expect(pending).toHaveLength(1);
      expect(sent).toHaveLength(0);
      release();
      await settle();
      expect(sent.map((s) => s.url)).toEqual(['https://erp.contoh.test/hook']);
    } finally {
      t.deps.http = http;
    }
  });

  it('cron tetap mengirim webhook walau penerapan perubahan organisasi gagal', async () => {
    sent.length = 0;
    failing = true;
    const id = (await t.call('budi', 'POST', '/requests', purchase(4_000_000))).body.id;
    expect((await decide('maya', id, 'reject', { comment: 'Tidak perlu' })).status).toBe(200);
    failing = false;

    const db = t.env.DB;
    const broken = new Proxy(db, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (sql.includes('FROM org_changes')) throw new Error('org_changes unavailable');
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, prop);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(runCron(broken, t.deps, new Date(Date.now() + 2 * 60_000))).rejects.toThrow('Scheduled run failed');
    expect(sent.map((s) => JSON.parse(s.body).request.id)).toEqual([id]);
  });
});
