import { Hono } from 'hono';
import { startRequest, type RequestState } from '@sentinel/engine';
import type { AppEnv, Deps } from './env';
import { persist } from './requests';
import { randomToken, shortId } from './security';
import { D1Directory, auditStatement, currentVersions, getVersion, loadRequest } from './store';

type Row = Record<string, unknown>;

// Two-way integration. Other systems file requests through the API with a per-system key and
// learn the outcome through webhooks. Approval logic itself lives only in Sentinel: a request
// filed here follows the active flow exactly like one filed in the web app.

const FINAL: Record<string, string> = { approved: 'request.approved', rejected: 'request.rejected', cancelled: 'request.cancelled' };
/** Minutes to wait before attempt 2, 3, … After the last one the delivery is marked failed. */
const BACKOFF_MINUTES = [1, 5, 30, 120, 720];
const TIMEOUT_MS = 5_000;
const KEY_PREFIX = 'sk_sentinel_';

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = async (text: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

/** HMAC-SHA256 of `${timestamp}.${body}`, hex encoded. Receivers recompute it to verify the sender. */
export async function sign(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

/** Webhook targets must be HTTPS and must not carry credentials. */
function httpsUrl(value: unknown): URL | null {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch {
    return null;
  }
}

interface Client {
  id: string;
  name: string;
  signingSecret: string;
  callbackHosts: string[];
}

async function clientFromKey(db: D1Database, header: string | undefined): Promise<Client | null> {
  const key = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
  if (!key?.startsWith(KEY_PREFIX)) return null;
  const row = await db
    .prepare('SELECT id, name, signing_secret, callback_hosts FROM api_clients WHERE key_hash = ? AND revoked_at IS NULL')
    .bind(await sha256(key))
    .first<Row>();
  return row
    ? { id: row.id as string, name: row.name as string, signingSecret: row.signing_secret as string, callbackHosts: JSON.parse(row.callback_hosts as string) }
    : null;
}

const waitingOn = (state: RequestState) => state.tasks.filter((t) => t.status === 'open').map((t) => t.stepId);

/** Routes for other systems. Authenticated by API key, not by a user session. */
export function integrationApiRoutes(deps: Deps) {
  const app = new Hono<{ Bindings: AppEnv['Bindings']; Variables: { client: Client } }>();

  app.use('*', async (c, next) => {
    const client = await clientFromKey(c.env.DB, c.req.header('authorization'));
    if (!client) return c.json({ error: 'Missing or invalid API key. Send it as "Authorization: Bearer <key>".' }, 401);
    c.set('client', client);
    await next();
  });

  app.get('/flows', async (c) => {
    const versions = await currentVersions(c.env.DB, new Date());
    return c.json(versions.map((v) => ({ key: v.flowKey, name: v.definition.name, fields: v.definition.fields })));
  });

  app.post('/requests', async (c) => {
    const client = c.var.client;
    const body = await c.req
      .json<{ flowKey?: string; requesterEmail?: string; data?: Record<string, unknown>; externalRef?: string; callbackUrl?: string }>()
      .catch(() => null);
    if (!body?.flowKey || !body.requesterEmail) return c.json({ error: 'flowKey and requesterEmail are required' }, 400);
    const externalRef = body.externalRef ? String(body.externalRef).slice(0, 200) : null;

    // Retrying with the same externalRef returns the request created the first time.
    if (externalRef) {
      const existing = await c.env.DB.prepare('SELECT request_id FROM request_sources WHERE client_id = ? AND external_ref = ?').bind(client.id, externalRef).first<Row>();
      if (existing) {
        const loaded = await loadRequest(c.env.DB, existing.request_id as string);
        return c.json({ id: existing.request_id, status: loaded?.state.status, duplicate: true }, 200);
      }
    }

    let callbackUrl: string | null = null;
    if (body.callbackUrl) {
      const url = httpsUrl(body.callbackUrl);
      if (!url) return c.json({ error: 'callbackUrl must be an https URL' }, 400);
      if (!client.callbackHosts.includes(url.hostname)) {
        return c.json({ error: `callbackUrl host "${url.hostname}" is not allowed for this API client. Ask an administrator to add it.` }, 400);
      }
      callbackUrl = url.toString();
    }

    const requester = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(String(body.requesterEmail).toLowerCase()).first<Row>();
    if (!requester) return c.json({ error: `No employee with email ${body.requesterEmail}` }, 422);

    const now = new Date();
    const version = (await currentVersions(c.env.DB, now)).find((v) => v.flowKey === body.flowKey);
    if (!version) return c.json({ error: 'Flow not found or not yet in effect' }, 404);

    const result = await startRequest(
      version,
      { id: shortId('REQ'), requesterId: requester.id as string, data: body.data ?? {} },
      { directory: new D1Directory(c.env.DB), now },
    );
    // The source row goes in first so that a final state reached during persist already knows its callback URL.
    await c.env.DB.prepare('INSERT INTO request_sources (request_id, client_id, external_ref, callback_url) VALUES (?, ?, ?, ?)')
      .bind(result.state.id, client.id, externalRef, callbackUrl)
      .run();
    try {
      await persist(c.env.DB, deps, version, result, null, now);
    } catch (e) {
      await c.env.DB.prepare('DELETE FROM request_sources WHERE request_id = ?').bind(result.state.id).run();
      throw e;
    }
    await auditStatement(c.env.DB, {
      at: now.toISOString(),
      actor: { type: 'system' },
      action: 'request_submitted_via_api',
      flowVersionId: version.id,
      requestId: result.state.id,
      detail: { clientId: client.id, clientName: client.name, externalRef },
    }).run();
    return c.json({ id: result.state.id, status: result.state.status, waitingOn: waitingOn(result.state) }, 201);
  });

  /** A system can only read requests it filed itself. */
  app.get('/requests/:id', async (c) => {
    const source = await c.env.DB.prepare('SELECT external_ref FROM request_sources WHERE request_id = ? AND client_id = ?').bind(c.req.param('id'), c.var.client.id).first<Row>();
    const loaded = source ? await loadRequest(c.env.DB, c.req.param('id')) : null;
    if (!loaded) return c.json({ error: 'Request not found' }, 404);
    const { state } = loaded;
    return c.json({ id: state.id, flowKey: state.flowKey, status: state.status, externalRef: source!.external_ref, submittedAt: loaded.createdAt, waitingOn: waitingOn(state) });
  });

  return app;
}

/** Queues one delivery per target when a request reaches a final status, then tries to send them. */
export async function notifyFinal(db: D1Database, deps: Deps, state: RequestState, now: Date): Promise<void> {
  const event = FINAL[state.status];
  if (!event) return;
  const source = await db
    .prepare(
      `SELECT s.external_ref, s.callback_url, c.signing_secret FROM request_sources s JOIN api_clients c ON c.id = s.client_id WHERE s.request_id = ?`,
    )
    .bind(state.id)
    .first<Row>();
  const { results: hooks } = await db
    .prepare('SELECT url, secret FROM webhooks WHERE deleted_at IS NULL AND (flow_key IS NULL OR flow_key = ?)')
    .bind(state.flowKey)
    .all<Row>();
  const targets = hooks.map((h) => ({ url: h.url as string, secret: h.secret as string }));
  if (source?.callback_url) targets.push({ url: source.callback_url as string, secret: source.signing_secret as string });
  if (targets.length === 0) return;

  const requester = await db.prepare('SELECT email FROM users WHERE id = ?').bind(state.requesterId).first<Row>();
  const at = now.toISOString();
  const ids: string[] = [];
  for (const target of targets) {
    const id = `whd_${randomToken(12)}`;
    const payload = JSON.stringify({
      id,
      event,
      occurredAt: at,
      request: {
        id: state.id,
        flowKey: state.flowKey,
        flowVersionId: state.flowVersionId,
        status: state.status,
        externalRef: source?.external_ref ?? null,
        requesterEmail: requester?.email ?? null,
      },
    });
    const res = await db
      .prepare(
        `INSERT OR IGNORE INTO webhook_deliveries (id, request_id, event, url, secret, payload, next_attempt_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, state.id, event, target.url, target.secret, payload, at, at)
      .run();
    if (res.meta.changes) ids.push(id);
  }
  for (const id of ids) await attempt(db, deps, id, now);
}

async function attempt(db: D1Database, deps: Deps, id: string, now: Date): Promise<boolean> {
  const row = await db.prepare(`SELECT * FROM webhook_deliveries WHERE id = ? AND status = 'pending'`).bind(id).first<Row>();
  if (!row) return false;
  const body = row.payload as string;
  const timestamp = Math.floor(now.getTime() / 1000);
  let error: string | null = null;
  try {
    const res = await (deps.http ?? fetch)(row.url as string, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Sentinel-Webhook/1',
        'x-sentinel-event': row.event as string,
        'x-sentinel-delivery': id,
        'x-sentinel-signature': `t=${timestamp},v1=${await sign(row.secret as string, timestamp, body)}`,
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}`;
  } catch (e) {
    error = String(e instanceof Error ? e.message : e).slice(0, 300);
  }

  const attempts = (row.attempts as number) + 1;
  const audit = async (action: string, detail: Record<string, unknown>) => {
    const req = await db.prepare('SELECT flow_version_id FROM requests WHERE id = ?').bind(row.request_id).first<Row>();
    await auditStatement(db, {
      at: now.toISOString(),
      actor: { type: 'system' },
      action,
      flowVersionId: (req?.flow_version_id as string) ?? 'integrations',
      requestId: row.request_id as string,
      detail: { deliveryId: id, host: new URL(row.url as string).hostname, event: row.event, attempts, ...detail },
    }).run();
  };
  if (!error) {
    await db.prepare(`UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, delivered_at = ?, next_attempt_at = NULL, last_error = NULL WHERE id = ?`).bind(attempts, now.toISOString(), id).run();
    await audit('webhook_delivered', {});
    return true;
  }
  const wait = BACKOFF_MINUTES[attempts - 1];
  if (wait === undefined) {
    await db.prepare(`UPDATE webhook_deliveries SET status = 'failed', attempts = ?, next_attempt_at = NULL, last_error = ? WHERE id = ?`).bind(attempts, error, id).run();
    await audit('webhook_failed', { error });
  } else {
    await db
      .prepare('UPDATE webhook_deliveries SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?')
      .bind(attempts, new Date(now.getTime() + wait * 60_000).toISOString(), error, id)
      .run();
  }
  return false;
}

/** Run by the cron trigger: retries deliveries whose wait has passed. */
export async function deliverDue(db: D1Database, deps: Deps, now: Date): Promise<number> {
  const { results } = await db
    .prepare(`SELECT id FROM webhook_deliveries WHERE status = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 50`)
    .bind(now.toISOString())
    .all<Row>();
  let delivered = 0;
  for (const r of results) if (await attempt(db, deps, r.id as string, now)) delivered++;
  return delivered;
}

/** Administration of API clients, webhooks and deliveries. System administrators only. */
export function integrationAdminRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    if (!c.var.user.isAdmin) return c.json({ error: 'System administrators only' }, 403);
    await next();
  });
  const audit = (db: D1Database, userId: string, action: string, detail: Record<string, unknown>) =>
    auditStatement(db, { at: new Date().toISOString(), actor: { type: 'user', id: userId }, action, flowVersionId: 'integrations', detail });

  app.get('/', async (c) => {
    const clients = await c.env.DB.prepare('SELECT id, name, key_prefix, callback_hosts, created_at, revoked_at FROM api_clients ORDER BY created_at DESC').all<Row>();
    const hooks = await c.env.DB.prepare('SELECT id, flow_key, url, created_at FROM webhooks WHERE deleted_at IS NULL ORDER BY created_at DESC').all<Row>();
    return c.json({
      clients: clients.results.map((r) => ({ id: r.id, name: r.name, keyPrefix: r.key_prefix, callbackHosts: JSON.parse(r.callback_hosts as string), createdAt: r.created_at, revokedAt: r.revoked_at })),
      webhooks: hooks.results.map((r) => ({ id: r.id, flowKey: r.flow_key, url: r.url, createdAt: r.created_at })),
    });
  });

  app.post('/clients', async (c) => {
    const body = await c.req.json<{ name?: string; callbackHosts?: string[] }>();
    const name = String(body.name ?? '').trim();
    if (!name) return c.json({ error: 'Give the API client a name, for example the system that will use it' }, 400);
    const hosts = [...new Set((body.callbackHosts ?? []).map((h) => String(h).trim().toLowerCase()).filter(Boolean))];
    if (hosts.some((h) => !/^[a-z0-9.-]+$/.test(h))) return c.json({ error: 'Callback hosts are host names only, for example hr.example.com' }, 400);
    const id = shortId('API');
    const apiKey = `${KEY_PREFIX}${randomToken(32)}`;
    const signingSecret = `whsec_${randomToken(24)}`;
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO api_clients (id, name, key_hash, key_prefix, signing_secret, callback_hosts, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
        id,
        name,
        await sha256(apiKey),
        apiKey.slice(0, KEY_PREFIX.length + 6),
        signingSecret,
        JSON.stringify(hosts),
        c.var.user.id,
        new Date().toISOString(),
      ),
      audit(c.env.DB, c.var.user.id, 'api_client_created', { clientId: id, name, callbackHosts: hosts }),
    ]);
    // The key and the signing secret are returned once and cannot be read again.
    return c.json({ id, name, apiKey, signingSecret, callbackHosts: hosts }, 201);
  });

  app.delete('/clients/:id', async (c) => {
    const res = await c.env.DB.prepare('UPDATE api_clients SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), c.req.param('id')).run();
    if (!res.meta.changes) return c.json({ error: 'API client not found or already revoked' }, 404);
    await audit(c.env.DB, c.var.user.id, 'api_client_revoked', { clientId: c.req.param('id') }).run();
    return c.json({ ok: true });
  });

  app.post('/webhooks', async (c) => {
    const body = await c.req.json<{ url?: string; flowKey?: string | null }>();
    const url = httpsUrl(body.url);
    if (!url) return c.json({ error: 'The webhook URL must start with https://' }, 400);
    const flowKey = body.flowKey ? String(body.flowKey) : null;
    if (flowKey && !(await c.env.DB.prepare('SELECT 1 FROM flow_versions WHERE flow_key = ? LIMIT 1').bind(flowKey).first())) {
      return c.json({ error: `Flow "${flowKey}" does not exist` }, 404);
    }
    const id = shortId('WH');
    const secret = `whsec_${randomToken(24)}`;
    await c.env.DB.batch([
      c.env.DB.prepare('INSERT INTO webhooks (id, flow_key, url, secret, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, flowKey, url.toString(), secret, c.var.user.id, new Date().toISOString()),
      audit(c.env.DB, c.var.user.id, 'webhook_created', { webhookId: id, flowKey, host: url.hostname }),
    ]);
    return c.json({ id, flowKey, url: url.toString(), secret }, 201);
  });

  app.delete('/webhooks/:id', async (c) => {
    const res = await c.env.DB.prepare('UPDATE webhooks SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').bind(new Date().toISOString(), c.req.param('id')).run();
    if (!res.meta.changes) return c.json({ error: 'Webhook not found' }, 404);
    await audit(c.env.DB, c.var.user.id, 'webhook_deleted', { webhookId: c.req.param('id') }).run();
    return c.json({ ok: true });
  });

  app.get('/deliveries', async (c) => {
    const status = c.req.query('status');
    const { results } = await c.env.DB.prepare(
      `SELECT id, request_id, event, url, status, attempts, next_attempt_at, last_error, created_at, delivered_at FROM webhook_deliveries
       WHERE (? IS NULL OR status = ?) ORDER BY created_at DESC LIMIT 100`,
    )
      .bind(status ?? null, status ?? null)
      .all<Row>();
    return c.json(
      results.map((r) => ({ id: r.id, requestId: r.request_id, event: r.event, url: r.url, status: r.status, attempts: r.attempts, nextAttemptAt: r.next_attempt_at, lastError: r.last_error, createdAt: r.created_at, deliveredAt: r.delivered_at })),
    );
  });

  /** Sends a pending or failed delivery again right now. */
  app.post('/deliveries/:id/retry', async (c) => {
    const id = c.req.param('id');
    const res = await c.env.DB.prepare(`UPDATE webhook_deliveries SET status = 'pending', attempts = 0 WHERE id = ? AND status != 'delivered'`).bind(id).run();
    if (!res.meta.changes) return c.json({ error: 'Delivery not found or already delivered' }, 404);
    const delivered = await attempt(c.env.DB, deps, id, new Date());
    return c.json({ delivered });
  });

  return app;
}
