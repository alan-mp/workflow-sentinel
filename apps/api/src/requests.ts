import { Hono } from 'hono';
import {
  EngineError,
  InMemoryDirectory,
  act,
  checkSla,
  flattenSteps,
  resubmit,
  startRequest,
  superiorOf,
  type AuditEvent,
  type RequestState,
  type Result,
} from '@sentinel/engine';
import type { AppEnv, Deps, SessionUser } from './env';
import { notifyFinal, sendDeliveries } from './integrations';
import { logError } from './log';
import { randomToken, shortId } from './security';
import {
  D1Directory,
  activeDelegations,
  auditStatement,
  commit,
  notificationStatement,
  currentVersions,
  getVersion,
  loadOrg,
  loadRequest,
  noticesFor,
  type StoredVersion,
} from './store';

type Row = Record<string, unknown>;

/** Hands work to the runtime to finish after the response is sent. */
export type Defer = (work: Promise<unknown>) => void;

/** Defer for a route: work goes to ctx.waitUntil, so it is neither dropped nor awaited by the caller. */
export const inBackground =
  (c: { executionCtx: { waitUntil(promise: Promise<unknown>): void } }): Defer =>
  (work) =>
    c.executionCtx.waitUntil(work);

/**
 * Simpan hasil mesin, lalu jalankan efek samping (email, ERP). Webhooks go to `defer` when given;
 * without it (cron) they stay queued and deliverDue sends them later in the same run.
 */
export async function persist(
  db: D1Database,
  deps: Deps,
  version: StoredVersion,
  result: Result,
  prevRev: number | null,
  now: Date,
  defer?: Defer,
): Promise<void> {
  const notices = await noticesFor(db, result.events, result.state, version.definition, now);
  await commit(db, { state: result.state, prevRev, events: result.events, notices, now });

  for (const n of notices) {
    const to = await db.prepare('SELECT email FROM users WHERE id = ?').bind(n.userId).first<Row>();
    if (to) await deps.email.send({ to: to.email as string, subject: 'Approval', body: n.message });
  }
  if (result.events.some((e) => e.action === 'request_approved')) {
    const base: Omit<AuditEvent, 'action'> = {
      at: now.toISOString(),
      actor: { type: 'system' },
      flowVersionId: version.id,
      requestId: result.state.id,
    };
    try {
      const pushed = await deps.erp.pushApproved(result.state);
      if (pushed) await auditStatement(db, { ...base, action: 'erp_synced', detail: pushed }).run();
    } catch (e) {
      await auditStatement(db, { ...base, action: 'erp_sync_failed', detail: { error: String(e) } }).run();
    }
  }
  // Tell other systems the outcome. A failure here never undoes the decision; it is retried by cron.
  if (result.events.length > 0) {
    try {
      const queued = await notifyFinal(db, result.state, now);
      if (queued.length > 0 && defer) defer(sendDeliveries(db, deps, queued, now));
    } catch (e) {
      logError('webhook queueing failed', e, { requestId: result.state.id });
    }
  }
}

/** Akses seperlunya: hanya pemohon, approver, dan delegasi aktif mereka. */
async function canView(db: D1Database, user: SessionUser, state: RequestState, now: Date): Promise<boolean> {
  const involved = new Set(state.tasks.flatMap((t) => t.assignees));
  if (state.requesterId === user.id || involved.has(user.id)) return true;
  const delegations = await activeDelegations(db, now, 'to', [user.id]);
  return delegations.some((d) => involved.has(d.fromUserId));
}

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Room for multipart boundaries and part headers around the file. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const TOO_LARGE = 'Files can be at most 10 MB. Compress the file or split it into parts.';

export function requestRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.get('/flows', async (c) => {
    const versions = await currentVersions(c.env.DB, new Date());
    return c.json(versions.map((v) => ({ key: v.flowKey, name: v.definition.name, fields: v.definition.fields })));
  });

  app.get('/users', async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, name FROM users ORDER BY name').all();
    return c.json(results);
  });

  app.post('/requests', async (c) => {
    const body = await c.req.json<{ flowKey: string; data: Record<string, unknown> }>();
    const now = new Date();
    const version = (await currentVersions(c.env.DB, now)).find((v) => v.flowKey === body.flowKey);
    if (!version) return c.json({ error: 'Flow not found or not yet in effect' }, 404);
    const result = await startRequest(
      version,
      { id: shortId('REQ'), requesterId: c.var.user.id, data: body.data ?? {} },
      { directory: new D1Directory(c.env.DB), now },
    );
    await persist(c.env.DB, deps, version, result, null, now, inBackground(c));
    return c.json({ id: result.state.id }, 201);
  });

  app.get('/requests', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT r.id, r.flow_key, r.status, r.created_at, r.updated_at, json_extract(v.definition, '$.name') AS flow_name, v.definition,
              (SELECT json_group_array(json_object('stepId', t.step_id, 'assignees', json(t.assignees), 'createdAt', t.created_at, 'dueAt', t.due_at))
                 FROM tasks t WHERE t.request_id = r.id AND t.status = 'open') AS open_tasks
       FROM requests r JOIN flow_versions v ON v.id = r.flow_version_id
       WHERE r.requester_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    )
      .bind(c.var.user.id)
      .all<Row>();
    const ids = new Set<string>();
    const parsed = results.map((r) => {
      const open: { stepId: string; assignees: string[]; createdAt: string; dueAt: string | null }[] = JSON.parse((r.open_tasks as string) ?? '[]');
      open.forEach((t) => t.assignees.forEach((a) => ids.add(a)));
      return { r, open };
    });
    const names = new Map<string, string>();
    if (ids.size) {
      const { results: users } = await c.env.DB.prepare(`SELECT id, name FROM users WHERE id IN (${[...ids].map(() => '?').join(',')})`)
        .bind(...ids)
        .all<Row>();
      users.forEach((u) => names.set(u.id as string, u.name as string));
    }
    return c.json(
      parsed.map(({ r, open }) => {
        const steps = flattenSteps(JSON.parse(r.definition as string).steps);
        const { definition: _definition, open_tasks: _open, ...rest } = r;
        return {
          ...rest,
          waiting: open.map((t) => ({
            stepName: steps.find((s) => s.id === t.stepId)?.name ?? t.stepId,
            assignees: t.assignees.map((a) => names.get(a) ?? a),
            createdAt: t.createdAt,
            dueAt: t.dueAt,
          })),
        };
      }),
    );
  });

  app.get('/inbox', async (c) => {
    const me = c.var.user.id;
    const now = new Date();
    const delegators = (await activeDelegations(c.env.DB, now, 'to', [me])).map((d) => d.fromUserId);
    const ids = [me, ...delegators];
    const { results } = await c.env.DB.prepare(
      `SELECT DISTINCT t.id AS task_id, t.step_id, t.due_at, t.created_at, t.assignees, r.id AS request_id,
              u.name AS requester_name, v.definition
       FROM tasks t, json_each(t.assignees) a
       JOIN requests r ON r.id = t.request_id
       JOIN users u ON u.id = r.requester_id
       JOIN flow_versions v ON v.id = r.flow_version_id
       WHERE t.status = 'open' AND r.requester_id <> ? AND a.value IN (${ids.map(() => '?').join(',')})
       ORDER BY t.due_at IS NULL, t.due_at, t.created_at`,
    )
      .bind(me, ...ids)
      .all<Row>();
    return c.json(
      results.map((r) => {
        const def = JSON.parse(r.definition as string);
        const assignees: string[] = JSON.parse(r.assignees as string);
        return {
          taskId: r.task_id,
          requestId: r.request_id,
          flowName: def.name,
          stepName: flattenSteps(def.steps).find((s) => s.id === r.step_id)?.name ?? r.step_id,
          requesterName: r.requester_name,
          dueAt: r.due_at,
          createdAt: r.created_at,
          onBehalfOf: assignees.includes(me) ? null : delegators.find((d) => assignees.includes(d)),
        };
      }),
    );
  });

  app.get('/requests/:id', async (c) => {
    const now = new Date();
    const loaded = await loadRequest(c.env.DB, c.req.param('id'));
    if (!loaded || !(await canView(c.env.DB, c.var.user, loaded.state, now))) {
      return c.json({ error: 'Request not found' }, 404);
    }
    const { state } = loaded;
    const version = (await getVersion(c.env.DB, state.flowVersionId))!;
    const steps = flattenSteps(version.definition.steps);
    const me = c.var.user.id;
    const delegators = (await activeDelegations(c.env.DB, now, 'to', [me])).map((d) => d.fromUserId);
    const [events, attachments, users] = await Promise.all([
      c.env.DB.prepare('SELECT * FROM audit_events WHERE request_id = ? ORDER BY seq').bind(state.id).all<Row>(),
      c.env.DB.prepare('SELECT id, filename, size, uploaded_by, created_at FROM attachments WHERE request_id = ? ORDER BY created_at')
        .bind(state.id)
        .all(),
      c.env.DB.prepare('SELECT id, name FROM users').all<Row>(),
    ]);
    const stepName = (id: unknown) => steps.find((s) => s.id === id)?.name ?? (id as string | null);
    return c.json({
      id: state.id,
      flowName: version.definition.name,
      flowVersion: version.version,
      status: state.status,
      round: state.round,
      requesterId: state.requesterId,
      isRequester: state.requesterId === me,
      createdAt: loaded.createdAt,
      fields: version.definition.fields,
      data: state.data,
      tasks: state.tasks.map((t) => ({
        ...t,
        stepName: stepName(t.stepId),
        canAct:
          t.status === 'open' &&
          state.requesterId !== me &&
          (t.assignees.includes(me) || delegators.some((d) => t.assignees.includes(d))),
      })),
      timeline: events.results.map((e) => ({
        seq: e.seq,
        at: e.at,
        actorId: e.actor_id,
        actorType: e.actor_type,
        action: e.action,
        stepName: stepName(e.step_id),
        taskId: e.task_id,
        detail: e.detail ? JSON.parse(e.detail as string) : null,
      })),
      attachments: attachments.results,
      names: Object.fromEntries(users.results.map((u) => [u.id, u.name])),
    });
  });

  app.post('/requests/:id/decision', async (c) => {
    const body = await c.req.json<{
      taskId: string;
      type: 'approve' | 'reject' | 'request_revision';
      comment?: string;
      attachmentIds?: string[];
    }>();
    if (!['approve', 'reject', 'request_revision'].includes(body.type)) return c.json({ error: 'Unknown action' }, 400);
    const now = new Date();
    const loaded = await loadRequest(c.env.DB, c.req.param('id'));
    if (!loaded) return c.json({ error: 'Request not found' }, 404);
    const version = (await getVersion(c.env.DB, loaded.state.flowVersionId))!;
    const result = await act(
      loaded.state,
      version,
      { actorId: c.var.user.id, taskId: body.taskId, type: body.type, comment: body.comment, attachmentIds: body.attachmentIds },
      {
        directory: new D1Directory(c.env.DB),
        now,
        delegations: await activeDelegations(c.env.DB, now, 'to', [c.var.user.id]),
      },
    );
    await persist(c.env.DB, deps, version, result, loaded.rev, now, inBackground(c));
    return c.json({ status: result.state.status });
  });

  app.post('/requests/:id/resubmit', async (c) => {
    const body = await c.req.json<{ data: Record<string, unknown> }>();
    const now = new Date();
    const loaded = await loadRequest(c.env.DB, c.req.param('id'));
    if (!loaded || loaded.state.requesterId !== c.var.user.id) return c.json({ error: 'Request not found' }, 404);
    const version = (await getVersion(c.env.DB, loaded.state.flowVersionId))!;
    const result = await resubmit(
      loaded.state,
      version,
      { actorId: c.var.user.id, data: body.data ?? {} },
      { directory: new D1Directory(c.env.DB), now },
    );
    await persist(c.env.DB, deps, version, result, loaded.rev, now, inBackground(c));
    return c.json({ status: result.state.status });
  });

  app.post('/requests/:id/attachments', async (c) => {
    const now = new Date();
    const loaded = await loadRequest(c.env.DB, c.req.param('id'));
    if (!loaded || !(await canView(c.env.DB, c.var.user, loaded.state, now))) {
      return c.json({ error: 'Request not found' }, 404);
    }
    // Refuse oversized uploads before the body is read; formData() holds the whole body in memory.
    if (Number(c.req.header('content-length') ?? 0) > MAX_ATTACHMENT_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return c.json({ error: TOO_LARGE }, 413);
    }
    const file = (await c.req.formData()).get('file') as unknown;
    if (!(file instanceof File)) return c.json({ error: 'No file provided' }, 400);
    if (file.size > MAX_ATTACHMENT_BYTES) return c.json({ error: TOO_LARGE }, 413);
    const id = randomToken(8);
    // R2 takes the File itself, so the upload is not copied into a second buffer.
    await c.env.FILES.put(`attachments/${id}`, file, { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
    await c.env.DB.batch([
      c.env.DB.prepare(
        'INSERT INTO attachments (id, request_id, uploaded_by, filename, content_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, loaded.state.id, c.var.user.id, file.name, file.type || 'application/octet-stream', file.size, now.toISOString()),
      auditStatement(c.env.DB, {
        at: now.toISOString(),
        actor: { type: 'user', id: c.var.user.id },
        action: 'attachment_added',
        flowVersionId: loaded.state.flowVersionId,
        requestId: loaded.state.id,
        detail: { attachmentId: id, filename: file.name },
      }),
    ]);
    return c.json({ id, filename: file.name }, 201);
  });

  app.get('/attachments/:id', async (c) => {
    const row = await c.env.DB.prepare('SELECT * FROM attachments WHERE id = ?').bind(c.req.param('id')).first<Row>();
    const loaded = row && (await loadRequest(c.env.DB, row.request_id as string));
    if (!row || !loaded || !(await canView(c.env.DB, c.var.user, loaded.state, new Date()))) {
      return c.json({ error: 'File not found' }, 404);
    }
    const object = await c.env.FILES.get(`attachments/${row.id}`);
    if (!object) return c.json({ error: 'File not found' }, 404);
    return new Response(object.body, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="${encodeURIComponent(row.filename as string)}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  });

  app.get('/reports', async (c) => {
    // Bawahan langsung dihitung dari struktur: siapa pun yang atasan langsungnya saya.
    const org = await loadOrg(c.env.DB);
    const directory = new InMemoryDirectory(org);
    const now = new Date();
    const reports = [];
    for (const u of org.users) {
      if (u.id === c.var.user.id) continue;
      const superior = await superiorOf(u, { directory, now }).catch(() => undefined);
      if (superior?.user.id === c.var.user.id) reports.push({ id: u.id, name: u.name });
    }
    return c.json(reports);
  });

  app.get('/delegations', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT d.id, d.from_user_id, d.to_user_id, d.starts_at, d.ends_at, d.created_by,
              f.name AS from_name, t.name AS to_name, b.name AS created_by_name
       FROM delegations d JOIN users f ON f.id = d.from_user_id JOIN users t ON t.id = d.to_user_id
       LEFT JOIN users b ON b.id = d.created_by
       WHERE (d.from_user_id = ?1 OR d.to_user_id = ?1 OR d.created_by = ?1) AND d.ends_at > ?2 ORDER BY d.starts_at`,
    )
      .bind(c.var.user.id, new Date().toISOString())
      .all();
    return c.json(results);
  });

  app.post('/delegations', async (c) => {
    const body = await c.req.json<{ toUserId: string; startsAt: string; endsAt: string; fromUserId?: string }>();
    const me = c.var.user;
    const fromUserId = body.fromUserId || me.id;
    const starts = Date.parse(body.startsAt);
    const ends = Date.parse(body.endsAt);
    if (Number.isNaN(starts) || Number.isNaN(ends) || ends <= starts) {
      return c.json({ error: 'A delegation needs valid start and end times' }, 400);
    }
    if (body.toUserId === fromUserId) return c.json({ error: 'You cannot delegate to the same person' }, 400);
    const directory = new D1Directory(c.env.DB);
    const [from, to] = await Promise.all([directory.getUser(fromUserId), directory.getUser(body.toUserId)]);
    if (!from || !to) return c.json({ error: 'User not found' }, 400);
    // Atas nama orang lain hanya boleh oleh atasan langsungnya.
    const superior = fromUserId === me.id ? undefined : await superiorOf(from, { directory, now: new Date() }).catch(() => undefined);
    if (fromUserId !== me.id && superior?.user.id !== me.id) {
      return c.json({ error: "Only the direct superior can create a delegation on someone else's behalf" }, 403);
    }
    const id = randomToken(8);
    const now = new Date().toISOString();
    const fmt = (ms: number) => new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short' });
    const period = `${fmt(starts)} to ${fmt(ends)} WIB`;
    const stmts = [
      c.env.DB.prepare(
        'INSERT INTO delegations (id, from_user_id, to_user_id, starts_at, ends_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, fromUserId, body.toUserId, new Date(starts).toISOString(), new Date(ends).toISOString(), now, me.id),
      notificationStatement(c.env.DB, { userId: body.toUserId, message: `You received an approval delegation from ${from.name} (${period}).` }, now),
    ];
    if (fromUserId !== me.id) {
      stmts.push(
        notificationStatement(
          c.env.DB,
          { userId: fromUserId, message: `${me.name} delegated your approvals to ${to.name} (${period}).` },
          now,
        ),
      );
    }
    await c.env.DB.batch(stmts);
    return c.json({ id }, 201);
  });

  app.delete('/delegations/:id', async (c) => {
    await c.env.DB.prepare('DELETE FROM delegations WHERE id = ?1 AND (from_user_id = ?2 OR created_by = ?2)')
      .bind(c.req.param('id'), c.var.user.id)
      .run();
    return c.json({ ok: true });
  });

  app.get('/notifications', async (c) => {
    const { results } = await c.env.DB.prepare(
      'SELECT id, request_id, message, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    )
      .bind(c.var.user.id)
      .all();
    return c.json(results);
  });

  app.post('/notifications/read', async (c) => {
    await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
      .bind(new Date().toISOString(), c.var.user.id)
      .run();
    return c.json({ ok: true });
  });

  return app;
}

/** Dijalankan Cron Trigger: pengingat dan eskalasi untuk tugas yang lewat tenggat. */
export async function runSla(db: D1Database, deps: Deps, now: Date): Promise<number> {
  const { results } = await db
    .prepare(`SELECT DISTINCT request_id FROM tasks WHERE status = 'open' AND due_at IS NOT NULL AND due_at <= ?`)
    .bind(now.toISOString())
    .all<Row>();
  let changed = 0;
  for (const row of results) {
    const loaded = await loadRequest(db, row.request_id as string);
    if (!loaded) continue;
    const version = (await getVersion(db, loaded.state.flowVersionId))!;
    const result = await checkSla(loaded.state, version, { directory: new D1Directory(db), now });
    if (result.events.length === 0) continue;
    await persist(db, deps, version, result, loaded.rev, now);
    changed++;
  }
  return changed;
}

export { EngineError };
