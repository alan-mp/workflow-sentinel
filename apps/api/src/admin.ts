import { Hono, type Context } from 'hono';
import {
  FlowDefinitionSchema,
  InMemoryDirectory,
  activateVersion,
  editDraft,
  simulate,
  validateDefinition,
  type AuditEvent,
  type FlowDefinition,
} from '@sentinel/engine';
import { drafterFromEnv } from './ai';
import type { AppEnv, Deps, SessionUser } from './env';
import { hashPassword, randomToken } from './security';
import { auditStatement, getVersion, notificationStatement, rowToUser, rowToVersion, type Citation, type StoredVersion } from './store';

type Row = Record<string, unknown>;

const BLANK = (key: string, name: string): FlowDefinition => ({
  key,
  name,
  fields: [],
  tables: [],
  steps: [{ type: 'approval', id: 'atasan', name: 'Atasan langsung', approver: { kind: 'manager', level: 1 }, slaHours: 24 }],
});

const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Dua peran yang sengaja dipisah:
 * - Pemilik proses: menyusun dan mengaktifkan alur miliknya saja.
 * - Admin sistem (IT): menunjuk pemilik dan mengimpor direktori, tetapi tidak
 *   bisa mengubah atau mengaktifkan alur, dan tidak bisa menjadi pemilik.
 */
export async function ownedFlows(db: D1Database, user: SessionUser): Promise<string[]> {
  if (user.isAdmin) return [];
  const { results } = await db.prepare('SELECT flow_key FROM flow_owners WHERE user_id = ? ORDER BY 1').bind(user.id).all<Row>();
  return results.map((r) => r.flow_key as string);
}
const owns = async (db: D1Database, user: SessionUser, flowKey: string) => (await ownedFlows(db, user)).includes(flowKey);
const NOT_OWNER = { error: 'Hanya pemilik proses alur ini yang boleh melakukannya' };

export function adminRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    if (!c.var.user.isAdmin && (await ownedFlows(c.env.DB, c.var.user)).length === 0) {
      return c.json({ error: 'Khusus pemilik proses dan admin sistem' }, 403);
    }
    await next();
  });
  const sysadminOnly = (c: Context<AppEnv>) => (c.var.user.isAdmin ? null : c.json({ error: 'Khusus admin sistem' }, 403));

  const ownedDraft = async (
    c: Context<AppEnv>,
  ): Promise<{ draft: StoredVersion; error?: undefined } | { draft?: undefined; error: Response }> => {
    const v = await getVersion(c.env.DB, c.req.param('id')!);
    if (!v || v.status !== 'draft') return { error: c.json({ error: 'Draf tidak ditemukan' }, 404) };
    if (!(await owns(c.env.DB, c.var.user, v.flowKey))) return { error: c.json(NOT_OWNER, 403) };
    return { draft: v };
  };
  const event = (userId: string, versionId: string, action: string, detail?: Record<string, unknown>): AuditEvent => ({
    at: new Date().toISOString(),
    actor: { type: 'user', id: userId },
    action,
    flowVersionId: versionId,
    detail,
  });

  // Pemilik melihat alur miliknya; admin sistem melihat semua alur (hanya baca).
  app.get('/flows', async (c) => {
    const mine = await ownedFlows(c.env.DB, c.var.user);
    const [versions, owners] = await Promise.all([
      c.env.DB.prepare(
        `SELECT v.id, v.flow_key, v.version, v.status, v.effective_from, v.edited_by,
                json_extract(v.definition, '$.name') AS name, a.name AS activated_by_name
         FROM flow_versions v LEFT JOIN users a ON a.id = v.activated_by ORDER BY v.flow_key, v.version DESC`,
      ).all<Row>(),
      c.env.DB.prepare('SELECT o.flow_key, u.id, u.name FROM flow_owners o JOIN users u ON u.id = o.user_id ORDER BY u.name').all<Row>(),
    ]);
    const keys = [...new Set([...versions.results, ...owners.results].map((r) => r.flow_key as string))].sort();
    return c.json(
      keys
        .filter((key) => c.var.user.isAdmin || mine.includes(key))
        .map((key) => {
          const list = versions.results.filter((v) => v.flow_key === key);
          return {
            key,
            name: (list[0]?.name as string | undefined) ?? key,
            canEdit: mine.includes(key),
            owners: owners.results.filter((o) => o.flow_key === key).map((o) => ({ id: o.id, name: o.name })),
            versions: list.map((v) => ({ ...v, edited_by: JSON.parse(v.edited_by as string) })),
          };
        }),
    );
  });

  // Menetapkan daftar pemilik sebuah alur (juga cara mendaftarkan alur baru).
  app.put('/flows/:key/owners', async (c) => {
    const denied = sysadminOnly(c);
    if (denied) return denied;
    const key = c.req.param('key');
    const { userIds } = await c.req.json<{ userIds: string[] }>();
    if (!/^[a-z0-9_]+$/.test(key)) return c.json({ error: 'Kunci alur: huruf kecil, angka, dan _' }, 400);
    const ids = [...new Set(Array.isArray(userIds) ? userIds : [])];
    if (ids.length < 2) return c.json({ error: 'Tiap alur butuh minimal dua pemilik, supaya ada orang kedua yang mengaktifkan' }, 400);
    for (const id of ids) {
      const u = await c.env.DB.prepare('SELECT is_admin FROM users WHERE id = ?').bind(id).first<Row>();
      if (!u) return c.json({ error: `User ${id} tidak ditemukan` }, 400);
      if (u.is_admin === 1) return c.json({ error: 'Admin sistem tidak boleh menjadi pemilik proses' }, 400);
    }
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM flow_owners WHERE flow_key = ?').bind(key),
      ...ids.map((id) =>
        c.env.DB.prepare('INSERT INTO flow_owners (flow_key, user_id, assigned_by, assigned_at) VALUES (?, ?, ?, ?)').bind(key, id, c.var.user.id, now),
      ),
      // Bukan perubahan versi, jadi kolom versi diisi penanda alurnya.
      auditStatement(c.env.DB, event(c.var.user.id, `flow:${key}`, 'owners_assigned', { owners: ids })),
    ]);
    return c.json({ owners: ids });
  });

  app.get('/users', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM users ORDER BY name').all<Row>();
    return c.json(results.map(rowToUser));
  });

  app.post('/drafts', async (c) => {
    const body = await c.req.json<{ flowKey: string; name?: string }>();
    if (!/^[a-z0-9_]+$/.test(body.flowKey ?? '')) return c.json({ error: 'Kunci alur: huruf kecil, angka, dan _' }, 400);
    if (!(await owns(c.env.DB, c.var.user, body.flowKey))) return c.json(NOT_OWNER, 403);
    const latest = await c.env.DB.prepare('SELECT * FROM flow_versions WHERE flow_key = ? ORDER BY version DESC LIMIT 1')
      .bind(body.flowKey)
      .first<Row>();
    const base = latest ? rowToVersion(latest) : null;
    const id = `${body.flowKey}-v${(base?.version ?? 0) + 1}-${randomToken(3)}`;
    const now = new Date().toISOString();
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO flow_versions (id, flow_key, version, status, definition, sop_url, sop_document_id, citations, created_by, edited_by, created_at)
         VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        body.flowKey,
        (base?.version ?? 0) + 1,
        JSON.stringify(base?.definition ?? BLANK(body.flowKey, body.name || body.flowKey)),
        base?.sopUrl ?? null,
        base?.sopDocumentId ?? null,
        JSON.stringify(base?.citations ?? []),
        c.var.user.id,
        JSON.stringify([c.var.user.id]),
        now,
      ),
      auditStatement(c.env.DB, event(c.var.user.id, id, 'draft_created', { basedOn: base?.id })),
    ]);
    return c.json({ id }, 201);
  });

  app.get('/versions/:id', async (c) => {
    const v = await getVersion(c.env.DB, c.req.param('id'));
    if (!v) return c.json({ error: 'Versi tidak ditemukan' }, 404);
    const canEdit = await owns(c.env.DB, c.var.user, v.flowKey);
    if (!canEdit && !c.var.user.isAdmin) return c.json({ error: 'Versi tidak ditemukan' }, 404);
    const [chat, sop, roles] = await Promise.all([
      c.env.DB.prepare('SELECT role, content, created_at FROM chat_messages WHERE flow_version_id = ? ORDER BY id').bind(v.id).all(),
      v.sopDocumentId
        ? c.env.DB.prepare('SELECT id, name, content FROM sop_documents WHERE id = ?').bind(v.sopDocumentId).first()
        : null,
      c.env.DB.prepare('SELECT DISTINCT r.value AS role FROM users u, json_each(u.roles) r ORDER BY 1').all<Row>(),
    ]);
    return c.json({
      ...v,
      issues: validateDefinition(v.definition).issues,
      chat: chat.results,
      sop,
      roles: roles.results.map((r) => r.role),
      canEdit,
      canActivate: canEdit && v.status === 'draft' && !v.editedBy.includes(c.var.user.id),
    });
  });

  app.put('/drafts/:id', async (c) => {
    const { draft, error } = await ownedDraft(c);
    if (!draft) return error;
    const body = await c.req.json<{ definition: unknown; sopUrl?: string }>();
    const parsed = FlowDefinitionSchema.safeParse(body.definition);
    if (!parsed.success) {
      return c.json({ error: 'Definisi tidak valid', issues: validateDefinition(body.definition).issues }, 400);
    }
    const next = editDraft(draft, c.var.user.id, { definition: parsed.data as FlowDefinition, sopUrl: body.sopUrl || undefined });
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE flow_versions SET definition = ?, sop_url = ?, edited_by = ? WHERE id = ?').bind(
        JSON.stringify(next.definition),
        next.sopUrl ?? null,
        JSON.stringify(next.editedBy),
        draft.id,
      ),
      auditStatement(c.env.DB, event(c.var.user.id, draft.id, 'draft_edited', { via: 'editor' })),
    ]);
    return c.json({ issues: validateDefinition(next.definition).issues });
  });

  // Simulasi memakai definisi yang dikirim, jadi bisa dicoba sebelum draf disimpan.
  app.post('/simulate', async (c) => {
    const body = await c.req.json<{ definition: unknown; requesterId: string; data: Record<string, unknown> }>();
    const checked = validateDefinition(body.definition);
    if (!checked.definition) return c.json({ error: 'Definisi belum valid', issues: checked.issues }, 400);
    const { results } = await c.env.DB.prepare('SELECT * FROM users').all<Row>();
    const users = results.map(rowToUser);
    const steps = await simulate(checked.definition, { requesterId: body.requesterId, data: body.data ?? {} }, new InMemoryDirectory(users));
    return c.json({ steps, names: Object.fromEntries(users.map((u) => [u.id, u.name])) });
  });

  app.post('/drafts/:id/sop', async (c) => {
    const { draft, error } = await ownedDraft(c);
    if (!draft) return error;
    const body = await c.req.json<{ name: string; content: string }>();
    if (!body.content?.trim()) return c.json({ error: 'Isi SOP kosong' }, 400);
    const sopId = randomToken(8);
    const editedBy = draft.editedBy.includes(c.var.user.id) ? draft.editedBy : [...draft.editedBy, c.var.user.id];
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO sop_documents (id, name, content, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(
        sopId,
        body.name || 'SOP',
        body.content,
        c.var.user.id,
        new Date().toISOString(),
      ),
      c.env.DB.prepare('UPDATE flow_versions SET sop_document_id = ?, sop_url = COALESCE(sop_url, ?), edited_by = ? WHERE id = ?').bind(
        sopId,
        `/api/admin/sop/${sopId}`,
        JSON.stringify(editedBy),
        draft.id,
      ),
      auditStatement(c.env.DB, event(c.var.user.id, draft.id, 'sop_attached', { sopDocumentId: sopId, name: body.name })),
    ]);
    return c.json({ id: sopId }, 201);
  });

  app.get('/sop/:id', async (c) => {
    const row = await c.env.DB.prepare('SELECT name, content FROM sop_documents WHERE id = ?').bind(c.req.param('id')).first<Row>();
    if (!row) return c.json({ error: 'SOP tidak ditemukan' }, 404);
    return c.text(row.content as string);
  });

  app.post('/drafts/:id/chat', async (c) => {
    const { draft, error } = await ownedDraft(c);
    if (!draft) return error;
    const drafter = deps.drafter ?? drafterFromEnv(c.env);
    if (!drafter) return c.json({ error: 'AI belum dikonfigurasi (AI_GATEWAY_URL dan ANTHROPIC_API_KEY)' }, 503);
    const { message } = await c.req.json<{ message: string }>();
    if (!message?.trim()) return c.json({ error: 'Pesan kosong' }, 400);

    const db = c.env.DB;
    const [history, sop, roles] = await Promise.all([
      db.prepare('SELECT role, content FROM chat_messages WHERE flow_version_id = ? ORDER BY id').bind(draft.id).all<Row>(),
      draft.sopDocumentId ? db.prepare('SELECT content FROM sop_documents WHERE id = ?').bind(draft.sopDocumentId).first<Row>() : null,
      db.prepare('SELECT DISTINCT r.value AS role FROM users u, json_each(u.roles) r ORDER BY 1').all<Row>(),
    ]);
    const sopText = (sop?.content as string | undefined) ?? undefined;

    let output;
    try {
      output = await drafter.run({
        definition: draft.definition,
        sopText,
        roles: roles.results.map((r) => r.role as string),
        history: history.results.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content as string })),
        message,
      });
    } catch (e) {
      console.error('AI drafter gagal', e);
      return c.json({ error: 'Layanan AI sedang bermasalah, coba lagi.' }, 502);
    }

    const now = new Date().toISOString();
    const insertChat = (role: string, content: string, by: string | null) =>
      db.prepare('INSERT INTO chat_messages (flow_version_id, role, content, created_by, created_at) VALUES (?, ?, ?, ?, ?)').bind(
        draft.id,
        role,
        content,
        by,
        now,
      );
    const stmts = [insertChat('user', message, c.var.user.id), insertChat('assistant', output.reply || '(tanpa jawaban)', null)];

    if (output.draft) {
      // Hasil AI diperiksa ulang di sini; AI hanya pernah menulis ke draf.
      const checked = validateDefinition(output.draft.definition);
      if (checked.definition) {
        const haystack = normalize(sopText ?? '');
        const citations: Citation[] = output.draft.citations.map((q) => ({
          target: String(q.target),
          quote: String(q.quote),
          section: q.section ? String(q.section) : undefined,
          source: q.source === 'admin' ? 'admin' : 'sop',
          verified: q.source !== 'admin' && haystack.includes(normalize(String(q.quote))),
        }));
        const next = editDraft(draft, c.var.user.id, { definition: checked.definition });
        stmts.push(
          db.prepare('UPDATE flow_versions SET definition = ?, citations = ?, edited_by = ? WHERE id = ?').bind(
            JSON.stringify(next.definition),
            JSON.stringify(citations),
            JSON.stringify(next.editedBy),
            draft.id,
          ),
          auditStatement(db, {
            at: now,
            actor: { type: 'ai', id: 'chat' },
            action: 'draft_edited',
            flowVersionId: draft.id,
            detail: { via: 'chat', onBehalfOf: c.var.user.id },
          }),
        );
      }
    }
    await db.batch(stmts);
    return c.json({ reply: output.reply, updated: Boolean(output.draft) });
  });

  app.post('/drafts/:id/submit', async (c) => {
    const { draft, error } = await ownedDraft(c);
    if (!draft) return error;
    const checked = validateDefinition(draft.definition);
    if (!checked.ok) return c.json({ error: 'Draf masih punya masalah', issues: checked.issues }, 400);
    const { results } = await c.env.DB.prepare(
      'SELECT o.user_id AS id FROM flow_owners o JOIN users u ON u.id = o.user_id WHERE o.flow_key = ? AND u.is_admin = 0',
    )
      .bind(draft.flowKey)
      .all<Row>();
    const reviewers = results.map((r) => r.id as string).filter((id) => !draft.editedBy.includes(id));
    if (reviewers.length === 0) return c.json({ error: 'Tidak ada pemilik proses lain di alur ini yang bisa meninjau draf' }, 400);
    const now = new Date().toISOString();
    await c.env.DB.batch([
      auditStatement(c.env.DB, event(c.var.user.id, draft.id, 'version_submitted', { reviewers })),
      ...reviewers.map((userId) =>
        notificationStatement(
          c.env.DB,
          { userId, message: `Draf alur "${draft.definition.name}" v${draft.version} menunggu tinjauan dan aktivasi Anda.` },
          now,
        ),
      ),
    ]);
    return c.json({ reviewers: reviewers.length });
  });

  app.post('/drafts/:id/activate', async (c) => {
    const { draft, error } = await ownedDraft(c);
    if (!draft) return error;
    const body = await c.req.json<{ effectiveFrom: string }>();
    const effective = new Date(body.effectiveFrom);
    if (Number.isNaN(effective.getTime())) return c.json({ error: 'Tanggal berlaku tidak valid' }, 400);
    // Aktor selalu manusia dari sesi login; tidak ada jalur lain ke fungsi ini.
    const { version, events } = activateVersion(draft, {
      actor: { type: 'user', id: c.var.user.id },
      effectiveFrom: effective.toISOString(),
      now: new Date(),
    });
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE flow_versions SET status = 'active', effective_from = ?, activated_by = ?, activated_at = ? WHERE id = ? AND status = 'draft'`,
      ).bind(version.effectiveFrom!, version.activatedBy!, version.activatedAt!, draft.id),
      ...events.map((e) => auditStatement(c.env.DB, e)),
    ]);
    return c.json({ status: 'active', effectiveFrom: version.effectiveFrom });
  });

  app.get('/audit', async (c) => {
    const denied = sysadminOnly(c);
    if (denied) return denied;
    const { results } = await c.env.DB.prepare(
      `SELECT e.seq, e.at, e.actor_type, e.actor_id, e.action, e.flow_version_id, e.detail FROM audit_events e
       WHERE e.request_id IS NULL ORDER BY e.seq DESC LIMIT 100`,
    ).all();
    return c.json(results);
  });

  // Impor direktori dari CSV: id,email,name,department,manager_id,roles,is_admin (roles dipisah "|").
  app.post('/directory', async (c) => {
    const denied = sysadminOnly(c);
    if (denied) return denied;
    const lines = (await c.req.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const header = lines.shift()?.split(',').map((h) => h.trim());
    const need = ['id', 'email', 'name', 'department'];
    if (!header || need.some((h) => !header.includes(h))) return c.json({ error: `Kolom wajib: ${need.join(', ')}` }, 400);
    const created: { email: string; temporaryPassword: string }[] = [];
    const stmts: D1PreparedStatement[] = [];
    for (const line of lines) {
      const cells = line.split(',').map((x) => x.trim());
      const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
      if (need.some((h) => !row[h])) return c.json({ error: `Baris tidak lengkap: ${line}` }, 400);
      const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE id = ?').bind(row.id).first();
      let hash: string | null = null;
      if (!exists) {
        const temporaryPassword = randomToken(6);
        hash = await hashPassword(temporaryPassword);
        created.push({ email: row.email!, temporaryPassword });
      }
      stmts.push(
        c.env.DB.prepare(
          `INSERT INTO users (id, email, name, department, manager_id, roles, is_admin, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET email = excluded.email, name = excluded.name, department = excluded.department,
             manager_id = excluded.manager_id, roles = excluded.roles, is_admin = excluded.is_admin`,
        ).bind(
          row.id,
          row.email!.toLowerCase(),
          row.name,
          row.department,
          row.manager_id || null,
          JSON.stringify((row.roles ?? '').split('|').map((r) => r.trim()).filter(Boolean)),
          row.is_admin === '1' || row.is_admin === 'true' ? 1 : 0,
          hash,
        ),
      );
    }
    if (stmts.length) await c.env.DB.batch(stmts);
    return c.json({ imported: stmts.length, created });
  });

  return app;
}
