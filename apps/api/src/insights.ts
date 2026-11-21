import { ANOMALY_SETTINGS, detectAnomalies, flattenSteps, type Anomaly, type AuditEvent, type RequestState } from '@sentinel/engine';
import { summarizerFromEnv, type SummaryInput } from './ai';
import type { Deps, Env } from './env';
import { logError } from './log';
import type { Defer } from './requests';
import { auditStatement, getVersion, loadRequest, type StoredVersion } from './store';

type Row = Record<string, unknown>;

// What Sentinel notices about a request. Anomaly flags are deterministic and computed while the
// request is filed; the AI briefing is written afterwards in the background, so nobody waits for it.
// Neither ever changes routing or a decision.

const MAX_ATTEMPTS = 3;

export interface Insight {
  status: 'pending' | 'ready' | 'failed' | 'unavailable';
  summary: string | null;
  /** Present only for viewers who are not the requester. */
  anomalies?: Anomaly[];
  anomalyNote?: string | null;
}

/** Flags the request against earlier requests of the same flow and queues the briefing. */
export async function analyzeRequest(db: D1Database, env: Env, deps: Deps, state: RequestState, version: StoredVersion, now: Date, defer?: Defer): Promise<Anomaly[]> {
  const since = new Date(now.getTime() - ANOMALY_SETTINGS.outlierWindowDays * 86_400_000).toISOString();
  const { results } = await db
    .prepare('SELECT id, requester_id, status, state, created_at FROM requests WHERE flow_key = ? AND id <> ? AND created_at >= ? ORDER BY created_at DESC LIMIT 2000')
    .bind(state.flowKey, state.id, since)
    .all<Row>();
  const anomalies = detectAnomalies({
    definition: version.definition,
    current: { id: state.id, requesterId: state.requesterId, data: state.data, createdAt: now.toISOString() },
    history: results.map((r) => ({
      id: r.id as string,
      requesterId: r.requester_id as string,
      status: r.status as string,
      createdAt: r.created_at as string,
      data: (JSON.parse(r.state as string) as RequestState).data,
    })),
  });
  const at = now.toISOString();
  const stmts = [
    db
      .prepare(
        `INSERT OR REPLACE INTO request_insights (request_id, round, anomalies, summary, anomaly_note, status, attempts, last_error, updated_at)
         VALUES (?, ?, ?, NULL, NULL, 'pending', 0, NULL, ?)`,
      )
      .bind(state.id, state.round, JSON.stringify(anomalies), at),
  ];
  if (anomalies.length) {
    const event: AuditEvent = {
      at,
      actor: { type: 'system' },
      action: 'anomalies_flagged',
      flowVersionId: version.id,
      requestId: state.id,
      detail: { round: state.round, anomalies: anomalies.map((a) => ({ kind: a.kind, related: a.related, ...a.detail })) },
    };
    stmts.push(auditStatement(db, event));
  }
  await db.batch(stmts);
  const work = writeBriefing(db, env, deps, state.id, now);
  if (defer) defer(work);
  else await work;
  return anomalies;
}

const show = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('en-US') : typeof v === 'boolean' ? (v ? 'yes' : 'no') : v == null ? '' : String(v));

async function briefingInput(db: D1Database, state: RequestState, version: StoredVersion, anomalies: Anomaly[]): Promise<SummaryInput> {
  const [users, units, attachments] = await Promise.all([
    db.prepare('SELECT id, name, title, unit_id FROM users').all<Row>(),
    db.prepare('SELECT id, name FROM org_units').all<Row>(),
    db.prepare('SELECT filename FROM attachments WHERE request_id = ? ORDER BY created_at').bind(state.id).all<Row>(),
  ]);
  const people = new Map(users.results.map((u) => [u.id as string, u]));
  const unitName = new Map(units.results.map((u) => [u.id as string, u.name as string]));
  const name = (id: string) => (people.get(id)?.name as string | undefined) ?? id;
  const me = people.get(state.requesterId);
  const steps = flattenSteps(version.definition.steps);
  return {
    flowName: version.definition.name,
    round: state.round,
    requester: {
      name: name(state.requesterId),
      title: (me?.title as string | null) ?? undefined,
      unit: me?.unit_id ? unitName.get(me.unit_id as string) : undefined,
    },
    fields: version.definition.fields.map((f) => ({ label: f.label, value: show(state.data[f.key]) })),
    steps: state.tasks.map((t) => ({
      name: steps.find((s) => s.id === t.stepId)?.name ?? t.stepId,
      status: t.status,
      assignees: t.assignees.map(name),
      basis: t.basis,
    })),
    attachments: attachments.results.map((a) => a.filename as string),
    anomalies: anomalies.map((a) => a.message),
  };
}

/** Writes the AI briefing for a request. Failures are recorded and retried by cron, never thrown. */
export async function writeBriefing(db: D1Database, env: Env, deps: Deps, requestId: string, now: Date): Promise<void> {
  const row = await db.prepare('SELECT * FROM request_insights WHERE request_id = ?').bind(requestId).first<Row>();
  const loaded = await loadRequest(db, requestId);
  if (!row || !loaded) return;
  const summarizer = deps.summarizer ?? summarizerFromEnv(env);
  const at = now.toISOString();
  if (!summarizer) {
    await db.prepare(`UPDATE request_insights SET status = 'unavailable', updated_at = ? WHERE request_id = ?`).bind(at, requestId).run();
    return;
  }
  const version = (await getVersion(db, loaded.state.flowVersionId))!;
  const anomalies = JSON.parse(row.anomalies as string) as Anomaly[];
  try {
    const out = await summarizer.summarize(await briefingInput(db, loaded.state, version, anomalies));
    // Only write if the request was not resubmitted meanwhile.
    await db
      .prepare(`UPDATE request_insights SET summary = ?, anomaly_note = ?, status = 'ready', attempts = attempts + 1, last_error = NULL, updated_at = ? WHERE request_id = ? AND round = ?`)
      .bind(out.summary, out.anomalyNote || null, at, requestId, row.round)
      .run();
  } catch (e) {
    logError('AI briefing failed', e, { requestId });
    await db
      .prepare(`UPDATE request_insights SET status = 'failed', attempts = attempts + 1, last_error = ?, updated_at = ? WHERE request_id = ? AND round = ?`)
      .bind(String(e instanceof Error ? e.message : e).slice(0, 300), at, requestId, row.round)
      .run();
  }
}

/** Run by cron: retries briefings that failed, a few times at most. */
export async function retryBriefings(db: D1Database, env: Env, deps: Deps, now: Date): Promise<number> {
  const { results } = await db
    .prepare(`SELECT request_id FROM request_insights WHERE status IN ('failed', 'pending') AND attempts < ? AND updated_at <= ? LIMIT 20`)
    .bind(MAX_ATTEMPTS, new Date(now.getTime() - 2 * 60_000).toISOString())
    .all<Row>();
  for (const r of results) await writeBriefing(db, env, deps, r.request_id as string, now);
  return results.length;
}

/** The insight as a given viewer may see it: the requester gets the summary but never the flags. */
export async function insightFor(db: D1Database, requestId: string, isRequester: boolean): Promise<Insight | null> {
  const row = await db.prepare('SELECT * FROM request_insights WHERE request_id = ?').bind(requestId).first<Row>();
  if (!row) return null;
  const insight: Insight = { status: row.status as Insight['status'], summary: (row.summary as string | null) ?? null };
  if (!isRequester) {
    insight.anomalies = JSON.parse(row.anomalies as string);
    insight.anomalyNote = (row.anomaly_note as string | null) ?? null;
  }
  return insight;
}
