import {
  InMemoryDirectory,
  flattenSteps,
  type AuditEvent,
  type AuthorityHolder,
  type Delegation,
  type Directory,
  type FlowDefinition,
  type FlowVersion,
  type OrgUnit,
  type ReportingException,
  type RequestState,
  type User,
} from '@sentinel/engine';
import { randomToken } from './security';

type Row = Record<string, unknown>;

export const rowToUser = (r: Row): User => ({
  id: r.id as string,
  name: r.name as string,
  department: r.department as string,
  unitId: (r.unit_id as string | null) ?? undefined,
});

export const rowToUnit = (r: Row): OrgUnit => ({
  id: r.id as string,
  name: r.name as string,
  level: r.level as OrgUnit['level'],
  parentId: (r.parent_id as string | null) ?? undefined,
  headUserId: (r.head_user_id as string | null) ?? undefined,
  actingHeadUserId: (r.acting_head_user_id as string | null) ?? undefined,
  actingUntil: (r.acting_until as string | null) ?? undefined,
});

export interface OrgPerson extends User {
  email: string;
  title?: string;
}
export interface StoredException extends ReportingException {
  id: string;
}
export interface OrgData {
  users: OrgPerson[];
  units: OrgUnit[];
  exceptions: StoredException[];
  authorities: { id: string; name: string; description: string }[];
  holders: Record<string, AuthorityHolder[]>;
}

/** Seluruh master organisasi dalam satu potret; cukup kecil untuk dibaca sekaligus. */
export async function loadOrg(db: D1Database): Promise<OrgData> {
  const [users, units, exceptions, authorities, holders] = await db.batch<Row>([
    db.prepare('SELECT id, email, name, department, unit_id, title FROM users ORDER BY name'),
    db.prepare('SELECT * FROM org_units ORDER BY name'),
    db.prepare('SELECT * FROM reporting_exceptions ORDER BY starts_at'),
    db.prepare('SELECT * FROM authorities ORDER BY name'),
    db.prepare('SELECT * FROM authority_holders ORDER BY authority_id, user_id'),
  ]);
  const byAuthority: Record<string, AuthorityHolder[]> = {};
  for (const a of authorities!.results) byAuthority[a.id as string] = [];
  for (const h of holders!.results) {
    (byAuthority[h.authority_id as string] ??= []).push({ userId: h.user_id as string, scopeUnitId: (h.scope_unit_id as string) || undefined });
  }
  return {
    users: users!.results.map((r) => ({ ...rowToUser(r), email: r.email as string, title: (r.title as string | null) ?? undefined })),
    units: units!.results.map(rowToUnit),
    exceptions: exceptions!.results.map((r) => ({
      id: r.id as string,
      userId: r.user_id as string,
      toUserId: r.to_user_id as string,
      flowKey: (r.flow_key as string | null) ?? undefined,
      reason: r.reason as string,
      startsAt: r.starts_at as string,
      endsAt: r.ends_at as string,
    })),
    authorities: authorities!.results.map((r) => ({ id: r.id as string, name: r.name as string, description: r.description as string })),
    holders: byAuthority,
  };
}

/** Direktori organisasi dari database; potretnya dibaca sekali per pemakaian. */
export class D1Directory implements Directory {
  private loaded?: Promise<InMemoryDirectory>;
  constructor(private db: D1Database) {}
  private get dir() {
    return (this.loaded ??= loadOrg(this.db).then((org) => new InMemoryDirectory(org)));
  }
  async getUser(id: string) {
    return (await this.dir).getUser(id);
  }
  async getUnit(id: string) {
    return (await this.dir).getUnit(id);
  }
  async getExceptions(userId: string) {
    return (await this.dir).getExceptions(userId);
  }
  async getAuthorityHolders(authorityId: string) {
    return (await this.dir).getAuthorityHolders(authorityId);
  }
}

export interface Citation {
  /** ID langkah, atau "tabel.baris" untuk baris aturan. */
  target: string;
  quote: string;
  section?: string;
  source: 'sop' | 'admin';
  /** Kutipan ditemukan persis di teks SOP. */
  verified: boolean;
}

export interface StoredVersion extends FlowVersion {
  citations: Citation[];
  sopDocumentId?: string;
  createdAt: string;
}

export const rowToVersion = (r: Row): StoredVersion => ({
  id: r.id as string,
  flowKey: r.flow_key as string,
  version: r.version as number,
  status: r.status as 'draft' | 'active',
  definition: JSON.parse(r.definition as string),
  sopUrl: (r.sop_url as string | null) ?? undefined,
  sopDocumentId: (r.sop_document_id as string | null) ?? undefined,
  citations: JSON.parse(r.citations as string),
  createdBy: r.created_by as string,
  editedBy: JSON.parse(r.edited_by as string),
  effectiveFrom: (r.effective_from as string | null) ?? undefined,
  activatedBy: (r.activated_by as string | null) ?? undefined,
  activatedAt: (r.activated_at as string | null) ?? undefined,
  createdAt: r.created_at as string,
});

export async function getVersion(db: D1Database, id: string): Promise<StoredVersion | null> {
  const r = await db.prepare('SELECT * FROM flow_versions WHERE id = ?').bind(id).first<Row>();
  return r ? rowToVersion(r) : null;
}

/** Versi yang berlaku sekarang untuk tiap alur. */
export async function currentVersions(db: D1Database, now: Date): Promise<StoredVersion[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM flow_versions WHERE status = 'active' AND effective_from <= ?
       ORDER BY flow_key, effective_from DESC, version DESC`,
    )
    .bind(now.toISOString())
    .all<Row>();
  const seen = new Set<string>();
  return results.map(rowToVersion).filter((v) => !seen.has(v.flowKey) && seen.add(v.flowKey));
}

export async function loadRequest(db: D1Database, id: string) {
  const r = await db.prepare('SELECT state, rev, created_at FROM requests WHERE id = ?').bind(id).first<Row>();
  if (!r) return null;
  return { state: JSON.parse(r.state as string) as RequestState, rev: r.rev as number, createdAt: r.created_at as string };
}

export function auditStatement(db: D1Database, e: AuditEvent): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_events (at, actor_type, actor_id, action, flow_version_id, request_id, step_id, task_id, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      e.at,
      e.actor.type,
      'id' in e.actor ? e.actor.id : null,
      e.action,
      e.flowVersionId,
      e.requestId ?? null,
      e.stepId ?? null,
      e.taskId ?? null,
      e.detail ? JSON.stringify(e.detail) : null,
    );
}

export function notificationStatement(db: D1Database, n: Notice, at: string): D1PreparedStatement {
  return db
    .prepare('INSERT INTO notifications (id, user_id, request_id, message, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(randomToken(8), n.userId, n.requestId ?? null, n.message, at);
}

export interface Notice {
  userId: string;
  requestId?: string;
  message: string;
}

export async function activeDelegations(db: D1Database, now: Date, where: 'to' | 'from', userIds: string[]) {
  if (userIds.length === 0) return [] as Delegation[];
  const at = now.toISOString();
  const column = where === 'to' ? 'to_user_id' : 'from_user_id';
  const { results } = await db
    .prepare(
      `SELECT from_user_id, to_user_id, starts_at, ends_at, created_by FROM delegations
       WHERE starts_at <= ? AND ends_at > ? AND ${column} IN (${userIds.map(() => '?').join(',')})`,
    )
    .bind(at, at, ...userIds)
    .all<Row>();
  return results.map((r) => ({
    fromUserId: r.from_user_id as string,
    toUserId: r.to_user_id as string,
    startsAt: r.starts_at as string,
    endsAt: r.ends_at as string,
    createdBy: (r.created_by as string | null) ?? undefined,
  }));
}

/** Siapa yang perlu diberi tahu untuk sekumpulan event. */
export async function noticesFor(
  db: D1Database,
  events: AuditEvent[],
  state: RequestState,
  definition: FlowDefinition,
  now: Date,
): Promise<Notice[]> {
  const steps = flattenSteps(definition.steps);
  const stepName = (id?: string) => steps.find((s) => s.id === id)?.name ?? id ?? '';
  const label = `${definition.name} ${state.id}`;
  const out: Notice[] = [];
  const push = (userIds: string[], message: string) =>
    userIds.forEach((userId) => out.push({ userId, requestId: state.id, message }));
  const withDelegates = async (ids: string[]) => {
    const delegates = (await activeDelegations(db, now, 'from', ids)).map((d) => d.toUserId);
    return [...new Set([...ids, ...delegates])].filter((id) => id !== state.requesterId);
  };

  for (const e of events) {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    switch (e.action) {
      case 'task_created':
        push(await withDelegates(d.assignees as string[]), `${label} is awaiting your approval (${stepName(e.stepId)}).`);
        break;
      case 'sla_reminder':
        push(await withDelegates(d.assignees as string[]), `Reminder: ${label} is past its due date (${stepName(e.stepId)}).`);
        break;
      case 'task_reassigned':
        push(await withDelegates(d.assignees as string[]), `${label} was reassigned to you after a change to the organization structure (${stepName(e.stepId)}).`);
        break;
      case 'sla_escalated':
        push(d.added as string[], `Escalation: ${label} is still undecided and now also awaits your approval (${stepName(e.stepId)}).`);
        break;
      case 'notification_requested':
        push(d.recipients as string[], `${label}: ${d.message as string}`);
        break;
      case 'request_approved':
        push([state.requesterId], `${label} was approved.`);
        break;
      case 'request_rejected':
        push([state.requesterId], `${label} was rejected.`);
        break;
      case 'request_revision_requested':
        push([state.requesterId], `${label} needs revision.`);
        break;
    }
  }
  return out;
}

export class ConflictError extends Error {}

/**
 * Menyimpan hasil mesin dalam satu transaksi: state, proyeksi tugas, audit
 * trail, dan notifikasi. Kalau permintaan sudah diubah proses lain, seluruh
 * transaksi batal.
 */
export async function commit(
  db: D1Database,
  input: { state: RequestState; prevRev: number | null; events: AuditEvent[]; notices: Notice[]; now: Date },
): Promise<void> {
  const { state, prevRev, events, notices, now } = input;
  const at = now.toISOString();
  const stmts: D1PreparedStatement[] = [];
  if (prevRev === null) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO requests (id, flow_key, flow_version_id, requester_id, status, state, rev, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .bind(state.id, state.flowKey, state.flowVersionId, state.requesterId, state.status, JSON.stringify(state), at, at),
    );
  } else {
    stmts.push(
      db
        .prepare('INSERT INTO write_guard (ok) SELECT 0 WHERE NOT EXISTS (SELECT 1 FROM requests WHERE id = ? AND rev = ?)')
        .bind(state.id, prevRev),
      db
        .prepare('UPDATE requests SET status = ?, state = ?, rev = rev + 1, updated_at = ? WHERE id = ?')
        .bind(state.status, JSON.stringify(state), at, state.id),
      db.prepare('DELETE FROM tasks WHERE request_id = ?').bind(state.id),
    );
  }
  for (const t of state.tasks) {
    stmts.push(
      db
        .prepare('INSERT INTO tasks (id, request_id, step_id, assignees, status, due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(t.id, state.id, t.stepId, JSON.stringify(t.assignees), t.status, t.dueAt ?? null, t.createdAt),
    );
  }
  events.forEach((e) => stmts.push(auditStatement(db, e)));
  notices.forEach((n) => stmts.push(notificationStatement(db, n, at)));
  try {
    await db.batch(stmts);
  } catch (e) {
    if (String(e).includes('CHECK')) throw new ConflictError('This request was just changed by someone else. Reload and try again.');
    throw e;
  }
}
