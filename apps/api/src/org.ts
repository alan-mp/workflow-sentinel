import { Hono, type Context } from 'hono';
import {
  InMemoryDirectory,
  UNIT_LEVELS,
  UNIT_LEVEL_LABEL,
  coverageGaps,
  flattenSteps,
  orgFindings,
  rerouteOpenTasks,
  superiorOf,
  type FlowDefinition,
  type OrgFinding,
  type UnitLevel,
} from '@sentinel/engine';
import { ownedFlows } from './admin';
import type { AppEnv, Deps, SessionUser } from './env';
import { persist } from './requests';
import { randomToken } from './security';
import { D1Directory, auditStatement, currentVersions, getVersion, loadOrg, loadRequest, type OrgData } from './store';

type Row = Record<string, unknown>;

// Master organisasi tidak pernah diubah langsung. Setiap perubahan adalah usulan
// yang diperiksa terhadap struktur saat ini, ditinjau orang kedua, lalu berlaku
// pada tanggalnya. Begitu berlaku, tugas yang masih terbuka dihitung ulang.

export type OrgChange =
  | { kind: 'unit_upsert'; id?: string; name: string; level: UnitLevel; parentId?: string | null }
  | { kind: 'unit_delete'; id: string }
  | { kind: 'unit_head'; id: string; headUserId?: string | null; actingHeadUserId?: string | null; actingUntil?: string | null }
  | { kind: 'user_place'; userId: string; unitId: string; title?: string | null }
  | { kind: 'exception_add'; id?: string; userId: string; toUserId: string; flowKey?: string | null; reason: string; startsAt: string; endsAt: string }
  | { kind: 'exception_end'; id: string }
  | { kind: 'authority_upsert'; id: string; name: string; description?: string }
  | { kind: 'authority_delete'; id: string }
  | { kind: 'holder_add'; authorityId: string; userId: string; scopeUnitId?: string | null }
  | { kind: 'holder_remove'; authorityId: string; userId: string; scopeUnitId?: string | null };

export class ChangeError extends Error {}
const fail = (message: string): never => {
  throw new ChangeError(message);
};

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
const short = (name: string) => name.replace(/\s*\(.*\)\s*$/, '');
const MAX_EXCEPTION_DAYS = 366;

/** Melengkapi usulan dengan ID yang dibuat sistem, supaya tinjauan dan penerapan memakai nilai yang sama. */
function withIds(change: OrgChange, org: OrgData): OrgChange {
  if (change.kind === 'unit_upsert' && !change.id) {
    const base = slug(change.name) || 'unit';
    let id = base;
    for (let n = 2; org.units.some((u) => u.id === id); n++) id = `${base}_${n}`;
    return { ...change, id };
  }
  if (change.kind === 'exception_add' && !change.id) return { ...change, id: randomToken(8) };
  return change;
}

/** Menerapkan usulan pada potret struktur tanpa menyentuh database; melempar ChangeError kalau tidak sah. */
export function applyToSnapshot(org: OrgData, change: OrgChange, now: Date): OrgData {
  const next: OrgData = structuredClone(org);
  const unit = (id: string) => next.units.find((u) => u.id === id) ?? fail(`Unit ${id} not found`);
  const user = (id: string) => next.users.find((u) => u.id === id) ?? fail(`Person ${id} not found`);
  const rank = (level: string) => UNIT_LEVELS.indexOf(level as UnitLevel);

  switch (change.kind) {
    case 'unit_upsert': {
      if (!change.name.trim()) fail('Unit name is required');
      if (rank(change.level) < 0) fail('Unknown unit level');
      const parent = change.parentId ? unit(change.parentId) : undefined;
      if (parent && parent.id === change.id) fail('A unit cannot be its own parent');
      if (parent && rank(parent.level) >= rank(change.level)) {
        fail(`A ${UNIT_LEVEL_LABEL[change.level]}-level unit must be below its parent (${parent.name}, ${UNIT_LEVEL_LABEL[parent.level]} level)`);
      }
      const existing = next.units.find((u) => u.id === change.id);
      for (const child of next.units.filter((u) => u.parentId === change.id)) {
        if (rank(child.level) <= rank(change.level)) fail(`A ${UNIT_LEVEL_LABEL[change.level]}-level unit cannot be at or below the level of a unit under it (${child.name})`);
      }
      if (existing) Object.assign(existing, { name: change.name.trim(), level: change.level, parentId: parent?.id });
      else next.units.push({ id: change.id!, name: change.name.trim(), level: change.level, parentId: parent?.id });
      break;
    }
    case 'unit_delete': {
      const u = unit(change.id);
      if (next.units.some((x) => x.parentId === u.id)) fail(`${u.name} still has units below it`);
      if (next.users.some((x) => x.unitId === u.id)) fail(`${u.name} still has members`);
      next.units = next.units.filter((x) => x.id !== u.id);
      for (const holders of Object.values(next.holders)) {
        if (holders.some((h) => h.scopeUnitId === u.id)) fail(`${u.name} is still used as an authority scope`);
      }
      break;
    }
    case 'unit_head': {
      const u = unit(change.id);
      const head = change.headUserId ? user(change.headUserId) : undefined;
      if (head && head.unitId !== u.id) fail(`${short(head.name)} is not placed in ${u.name}; a permanent head must be a member of the unit`);
      const acting = change.actingHeadUserId ? user(change.actingHeadUserId) : undefined;
      if (acting && head) fail('An acting head can be set only when there is no permanent head');
      if (acting && (!change.actingUntil || Number.isNaN(Date.parse(change.actingUntil)))) fail('An acting head needs an end date');
      if (acting && Date.parse(change.actingUntil!) <= now.getTime()) fail("The acting head's end date has already passed");
      u.headUserId = head?.id;
      u.actingHeadUserId = acting?.id;
      u.actingUntil = acting ? new Date(change.actingUntil!).toISOString() : undefined;
      break;
    }
    case 'user_place': {
      const person = user(change.userId);
      const target = unit(change.unitId);
      const heads = next.units.find((u) => u.headUserId === person.id && u.id !== target.id);
      if (heads) fail(`${short(person.name)} is still head of ${heads.name}; change the head first`);
      person.unitId = target.id;
      person.title = change.title?.trim() || undefined;
      let dept = target;
      for (let u: typeof target | undefined = target; u; u = u.parentId ? next.units.find((x) => x.id === u!.parentId) : undefined) {
        dept = u;
        if (u.level === 'departemen') break;
      }
      person.department = dept.level === 'departemen' ? dept.id : target.id;
      break;
    }
    case 'exception_add': {
      const person = user(change.userId);
      const to = user(change.toUserId);
      if (person.id === to.id) fail('A person cannot report to themselves');
      if (!change.reason.trim()) fail('A reason for the reporting exception is required');
      const starts = Date.parse(change.startsAt);
      const ends = Date.parse(change.endsAt);
      if (Number.isNaN(starts) || Number.isNaN(ends) || ends <= starts) fail('A reporting exception needs valid start and end dates');
      if (ends - starts > MAX_EXCEPTION_DAYS * 86_400_000) fail('A reporting exception can last at most one year; extend it with a new proposal');
      next.exceptions.push({
        id: change.id!,
        userId: person.id,
        toUserId: to.id,
        flowKey: change.flowKey || undefined,
        reason: change.reason.trim(),
        startsAt: new Date(starts).toISOString(),
        endsAt: new Date(ends).toISOString(),
      });
      break;
    }
    case 'exception_end': {
      const e = next.exceptions.find((x) => x.id === change.id) ?? fail('Reporting exception not found');
      e.endsAt = now.toISOString();
      break;
    }
    case 'authority_upsert': {
      if (!/^[a-z0-9_]+$/.test(change.id)) fail('Authority code may contain only lowercase letters, digits, and underscores');
      if (!change.name.trim()) fail('Authority name is required');
      const existing = next.authorities.find((a) => a.id === change.id);
      if (existing) Object.assign(existing, { name: change.name.trim(), description: change.description?.trim() ?? '' });
      else {
        next.authorities.push({ id: change.id, name: change.name.trim(), description: change.description?.trim() ?? '' });
        next.holders[change.id] = [];
      }
      break;
    }
    case 'authority_delete': {
      if (!next.authorities.some((a) => a.id === change.id)) fail('Authority not found');
      next.authorities = next.authorities.filter((a) => a.id !== change.id);
      delete next.holders[change.id];
      break;
    }
    case 'holder_add': {
      if (!next.authorities.some((a) => a.id === change.authorityId)) fail('Authority not found');
      user(change.userId);
      if (change.scopeUnitId) unit(change.scopeUnitId);
      const list = (next.holders[change.authorityId] ??= []);
      if (list.some((h) => h.userId === change.userId && (h.scopeUnitId ?? '') === (change.scopeUnitId ?? ''))) fail('This person already holds that authority with the same scope');
      list.push({ userId: change.userId, scopeUnitId: change.scopeUnitId || undefined });
      break;
    }
    case 'holder_remove': {
      const list = next.holders[change.authorityId] ?? fail('Authority not found');
      const kept = list.filter((h) => !(h.userId === change.userId && (h.scopeUnitId ?? '') === (change.scopeUnitId ?? '')));
      if (kept.length === list.length) fail('Holder of authority not found');
      next.holders[change.authorityId] = kept;
      break;
    }
  }
  const broken = findings(next, now).find((f) => ['UNIT_CYCLE', 'UNIT_BAD_PARENT', 'HEAD_UNKNOWN'].includes(f.code));
  if (broken) fail(broken.message);
  return next;
}

const names = (org: OrgData) => Object.fromEntries(org.authorities.map((a) => [a.id, a.name]));
const findings = (org: OrgData, now: Date): OrgFinding[] => orgFindings(org, now, org.authorities.map((a) => a.id), names(org));

/** Kalimat yang dibaca peninjau: apa yang berubah. */
export function describeChange(change: OrgChange, org: OrgData): string {
  const unit = (id?: string | null) => org.units.find((u) => u.id === id)?.name ?? id ?? '-';
  const user = (id?: string | null) => short(org.users.find((u) => u.id === id)?.name ?? id ?? '-');
  const authority = (id: string) => org.authorities.find((a) => a.id === id)?.name ?? id;
  switch (change.kind) {
    case 'unit_upsert':
      return org.units.some((u) => u.id === change.id)
        ? `Change unit ${unit(change.id)}: name ${change.name}, level ${UNIT_LEVEL_LABEL[change.level] ?? change.level}, parent ${change.parentId ? unit(change.parentId) : 'none'}`
        : `Add unit ${change.name} (${UNIT_LEVEL_LABEL[change.level] ?? change.level}) ${change.parentId ? `under ${unit(change.parentId)}` : 'at the top'}`;
    case 'unit_delete':
      return `Delete unit ${unit(change.id)}`;
    case 'unit_head':
      return change.headUserId
        ? `Head of ${unit(change.id)}: ${user(change.headUserId)}`
        : change.actingHeadUserId
          ? `Acting head of ${unit(change.id)}: ${user(change.actingHeadUserId)} until ${String(change.actingUntil).slice(0, 10)}`
          : `Remove head of ${unit(change.id)}`;
    case 'user_place':
      return `Place ${user(change.userId)} in ${unit(change.unitId)}${change.title ? ` as ${change.title}` : ''}`;
    case 'exception_add':
      return `Reporting exception: ${user(change.userId)} reports to ${user(change.toUserId)}${change.flowKey ? ` for flow ${change.flowKey}` : ''}, ${change.startsAt.slice(0, 10)} to ${change.endsAt.slice(0, 10)}. Reason: ${change.reason}`;
    case 'exception_end': {
      const e = org.exceptions.find((x) => x.id === change.id);
      return `End reporting exception: ${user(e?.userId)} reports to ${user(e?.toUserId)}`;
    }
    case 'authority_upsert':
      return org.authorities.some((a) => a.id === change.id) ? `Change authority ${change.name}` : `Add authority ${change.name} (${change.id})`;
    case 'authority_delete':
      return `Delete authority ${authority(change.id)}`;
    case 'holder_add':
      return `${user(change.userId)} holds authority ${authority(change.authorityId)}${change.scopeUnitId ? ` for ${unit(change.scopeUnitId)}` : ''}`;
    case 'holder_remove':
      return `Revoke authority ${authority(change.authorityId)} from ${user(change.userId)}${change.scopeUnitId ? ` (scope ${unit(change.scopeUnitId)})` : ''}`;
  }
}

function statements(db: D1Database, change: OrgChange, after: OrgData): D1PreparedStatement[] {
  switch (change.kind) {
    case 'unit_upsert':
      return [
        db
          .prepare(
            `INSERT INTO org_units (id, name, level, parent_id) VALUES (?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, level = excluded.level, parent_id = excluded.parent_id`,
          )
          .bind(change.id!, change.name.trim(), change.level, change.parentId || null),
      ];
    case 'unit_delete':
      return [db.prepare('DELETE FROM org_units WHERE id = ?').bind(change.id)];
    case 'unit_head': {
      const u = after.units.find((x) => x.id === change.id)!;
      return [
        db
          .prepare('UPDATE org_units SET head_user_id = ?, acting_head_user_id = ?, acting_until = ? WHERE id = ?')
          .bind(u.headUserId ?? null, u.actingHeadUserId ?? null, u.actingUntil ?? null, u.id),
      ];
    }
    case 'user_place': {
      const p = after.users.find((x) => x.id === change.userId)!;
      return [db.prepare('UPDATE users SET unit_id = ?, title = ?, department = ? WHERE id = ?').bind(p.unitId!, p.title ?? null, p.department, p.id)];
    }
    case 'exception_add': {
      const e = after.exceptions.find((x) => x.id === change.id)!;
      return [
        db
          .prepare('INSERT INTO reporting_exceptions (id, user_id, to_user_id, flow_key, reason, starts_at, ends_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(e.id, e.userId, e.toUserId, e.flowKey ?? null, e.reason, e.startsAt, e.endsAt),
      ];
    }
    case 'exception_end':
      return [db.prepare('UPDATE reporting_exceptions SET ends_at = ? WHERE id = ?').bind(after.exceptions.find((x) => x.id === change.id)!.endsAt, change.id)];
    case 'authority_upsert':
      return [
        db
          .prepare(
            `INSERT INTO authorities (id, name, description) VALUES (?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET name = excluded.name, description = excluded.description`,
          )
          .bind(change.id, change.name.trim(), change.description?.trim() ?? ''),
      ];
    case 'authority_delete':
      return [db.prepare('DELETE FROM authority_holders WHERE authority_id = ?').bind(change.id), db.prepare('DELETE FROM authorities WHERE id = ?').bind(change.id)];
    case 'holder_add':
      return [
        db.prepare('INSERT INTO authority_holders (authority_id, user_id, scope_unit_id) VALUES (?, ?, ?)').bind(change.authorityId, change.userId, change.scopeUnitId ?? ''),
      ];
    case 'holder_remove':
      return [
        db
          .prepare('DELETE FROM authority_holders WHERE authority_id = ? AND user_id = ? AND scope_unit_id = ?')
          .bind(change.authorityId, change.userId, change.scopeUnitId ?? ''),
      ];
  }
}

/** Wewenang yang dirujuk sebuah definisi alur, langsung atau lewat tabel aturan. */
function authoritiesIn(def: FlowDefinition): string[] {
  const out = new Set<string>();
  for (const s of flattenSteps(def.steps)) {
    if (s.type === 'approval' && s.approver.kind === 'role') out.add(s.approver.role);
    if (s.type === 'notify' && s.to.kind === 'role') out.add(s.to.role);
  }
  for (const t of def.tables) for (const r of t.rows) if (r.approver.kind === 'role') out.add(r.approver.role);
  return [...out];
}

/** Setelah struktur berubah, hitung ulang approver semua tugas yang masih terbuka. */
export async function rerouteAll(db: D1Database, deps: Deps, now: Date): Promise<number> {
  const { results } = await db.prepare(`SELECT id FROM requests WHERE status = 'in_progress'`).all<Row>();
  const directory = new D1Directory(db);
  let moved = 0;
  for (const row of results) {
    const loaded = await loadRequest(db, row.id as string);
    if (!loaded) continue;
    const version = (await getVersion(db, loaded.state.flowVersionId))!;
    const result = await rerouteOpenTasks(loaded.state, version, { directory, now });
    if (result.events.length === 0) continue;
    await persist(db, deps, version, result, loaded.rev, now);
    moved += result.events.length;
  }
  return moved;
}

/** Menerapkan satu usulan yang sudah disetujui. Usulan yang tidak lagi sah ditandai gagal dengan alasannya. */
async function applyChange(db: D1Database, deps: Deps, row: Row, now: Date): Promise<{ ok: boolean; error?: string; moved: number }> {
  const change = JSON.parse(row.payload as string) as OrgChange;
  const at = now.toISOString();
  let after: OrgData;
  try {
    after = applyToSnapshot(await loadOrg(db), change, now);
  } catch (e) {
    if (!(e instanceof ChangeError)) throw e;
    await db.prepare(`UPDATE org_changes SET status = 'failed', review_note = ?, applied_at = ? WHERE id = ?`).bind(`Could not be applied: ${e.message}`, at, row.id).run();
    return { ok: false, error: e.message, moved: 0 };
  }
  await db.batch([
    ...statements(db, change, after),
    db.prepare(`UPDATE org_changes SET status = 'applied', applied_at = ? WHERE id = ?`).bind(at, row.id),
    auditStatement(db, {
      at,
      actor: { type: 'user', id: row.reviewed_by as string },
      action: 'org_change_applied',
      flowVersionId: 'org',
      detail: { changeId: row.id, kind: change.kind, summary: row.summary, proposedBy: row.proposed_by, change },
    }),
  ]);
  return { ok: true, moved: await rerouteAll(db, deps, now) };
}

/** Dipanggil cron: menerapkan usulan yang sudah disetujui dan tanggal berlakunya tiba. */
export async function applyDueChanges(db: D1Database, deps: Deps, now: Date): Promise<number> {
  const { results } = await db
    .prepare(`SELECT * FROM org_changes WHERE status = 'scheduled' AND effective_from <= ? ORDER BY effective_from, proposed_at`)
    .bind(now.toISOString())
    .all<Row>();
  for (const row of results) await applyChange(db, deps, row, now);
  return results.length;
}

/** Admin sistem boleh mengelola master organisasi tanpa ditunjuk sebagai pemilik. */
export async function ownsOrg(db: D1Database, user: SessionUser): Promise<boolean> {
  if (user.isAdmin) return true;
  return Boolean(await db.prepare('SELECT 1 FROM org_owners WHERE user_id = ?').bind(user.id).first());
}

export function orgRoutes(deps: Deps) {
  const app = new Hono<AppEnv>();

  // Membaca: pemilik organisasi, pemilik proses (untuk menyusun alur), dan admin sistem.
  app.use('*', async (c, next) => {
    const user = c.var.user;
    if (!user.isAdmin && !(await ownsOrg(c.env.DB, user)) && (await ownedFlows(c.env.DB, user)).length === 0) {
      return c.json({ error: 'Organization owners, process owners, and system administrators only' }, 403);
    }
    await next();
  });
  const ownerOnly = async (c: Context<AppEnv>) =>
    (await ownsOrg(c.env.DB, c.var.user)) ? null : c.json({ error: 'Only an organization owner can propose or review changes' }, 403);

  app.get('/', async (c) => {
    const now = new Date();
    const db = c.env.DB;
    const [org, versions, loads, owners, pending] = await Promise.all([
      loadOrg(db),
      currentVersions(db, now),
      db.prepare(`SELECT a.value AS user_id, COUNT(*) AS n FROM tasks t, json_each(t.assignees) a WHERE t.status = 'open' GROUP BY a.value`).all<Row>(),
      db.prepare('SELECT o.user_id, u.name FROM org_owners o JOIN users u ON u.id = o.user_id ORDER BY u.name').all<Row>(),
      db.prepare(`SELECT COUNT(*) AS n FROM org_changes WHERE status IN ('pending', 'scheduled')`).first<Row>(),
    ]);
    const usage: Record<string, string[]> = {};
    for (const v of versions) for (const a of authoritiesIn(v.definition)) (usage[a] ??= []).push(v.definition.name);
    return c.json({
      ...org,
      findings: orgFindings(org, now, [...new Set([...org.authorities.map((a) => a.id), ...Object.keys(usage)])], names(org)),
      usage,
      loads: Object.fromEntries(loads.results.map((r) => [r.user_id, r.n])),
      owners: owners.results,
      pending: (pending?.n as number) ?? 0,
      canEdit: await ownsOrg(db, c.var.user),
      isAdmin: c.var.user.isAdmin,
      levels: UNIT_LEVELS,
    });
  });

  app.get('/changes', async (c) => {
    const { results } = await c.env.DB.prepare(
      `SELECT ch.*, p.name AS proposed_by_name, r.name AS reviewed_by_name FROM org_changes ch
       JOIN users p ON p.id = ch.proposed_by LEFT JOIN users r ON r.id = ch.reviewed_by
       ORDER BY CASE ch.status WHEN 'pending' THEN 0 WHEN 'scheduled' THEN 1 ELSE 2 END, ch.proposed_at DESC LIMIT 100`,
    ).all<Row>();
    return c.json(results.map((r) => ({ ...r, payload: JSON.parse(r.payload as string), impact: JSON.parse(r.impact as string), canReview: r.status === 'pending' && (c.var.user.isAdmin || r.proposed_by !== c.var.user.id) })));
  });

  app.post('/changes', async (c) => {
    const denied = await ownerOnly(c);
    if (denied) return denied;
    const body = await c.req.json<{ change: OrgChange; effectiveFrom?: string; note?: string }>();
    const now = new Date();
    const db = c.env.DB;
    const org = await loadOrg(db);
    let change: OrgChange;
    let after: OrgData;
    try {
      change = withIds(body.change, org);
      after = applyToSnapshot(org, change, now);
    } catch (e) {
      if (e instanceof ChangeError) return c.json({ error: e.message }, 400);
      throw e;
    }
    if (change.kind === 'authority_delete') {
      const { results } = await db.prepare(`SELECT definition FROM flow_versions`).all<Row>();
      const used = results.map((r) => JSON.parse(r.definition as string) as FlowDefinition).find((d) => authoritiesIn(d).includes(change.id));
      if (used) return c.json({ error: `Authority is still used by flow ${used.name}` }, 400);
    }
    const effective = body.effectiveFrom ? Date.parse(body.effectiveFrom) : now.getTime();
    if (Number.isNaN(effective)) return c.json({ error: 'Effective date is not valid' }, 400);
    // Dampak: temuan struktur yang muncul atau hilang kalau usulan ini diterapkan.
    const before = new Set(findings(org, now).map((f) => f.message));
    const afterFindings = findings(after, now);
    const afterSet = new Set(afterFindings.map((f) => f.message));
    const impact = [
      ...afterFindings.filter((f) => !before.has(f.message)).map((f) => ({ type: 'baru', level: f.level, message: f.message })),
      ...[...before].filter((m) => !afterSet.has(m)).map((m) => ({ type: 'selesai', level: 'ok', message: m })),
    ];
    const id = randomToken(8);
    const at = now.toISOString();
    await db.batch([
      db
        .prepare(
          `INSERT INTO org_changes (id, kind, payload, summary, note, status, effective_from, proposed_by, proposed_at, impact)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
        )
        .bind(id, change.kind, JSON.stringify(change), describeChange(change, org), body.note?.trim() || null, new Date(Math.max(effective, now.getTime())).toISOString(), c.var.user.id, at, JSON.stringify(impact)),
      auditStatement(db, { at, actor: { type: 'user', id: c.var.user.id }, action: 'org_change_proposed', flowVersionId: 'org', detail: { changeId: id, change } }),
    ]);
    if (!c.var.user.isAdmin) return c.json({ id, impact }, 201);
    // Admin sistem tidak menunggu peninjau kedua: usulannya langsung disetujui atas namanya dan ditandai di audit.
    const note = 'Admin override: applied without a second reviewer';
    await db.batch([
      db.prepare(`UPDATE org_changes SET status = 'scheduled', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?`).bind(c.var.user.id, at, note, id),
      auditStatement(db, { at, actor: { type: 'user', id: c.var.user.id }, action: 'org_change_admin_override', flowVersionId: 'org', detail: { changeId: id, adminOverride: true } }),
    ]);
    const row = (await db.prepare('SELECT * FROM org_changes WHERE id = ?').bind(id).first<Row>())!;
    if ((row.effective_from as string) > at) return c.json({ id, impact, status: 'scheduled', effectiveFrom: row.effective_from }, 201);
    const result = await applyChange(db, deps, row, now);
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ id, impact, status: 'applied', movedTasks: result.moved }, 201);
  });

  app.post('/changes/:id/review', async (c) => {
    const denied = await ownerOnly(c);
    if (denied) return denied;
    const body = await c.req.json<{ decision: 'approve' | 'reject'; note?: string }>();
    const db = c.env.DB;
    const row = await db.prepare('SELECT * FROM org_changes WHERE id = ?').bind(c.req.param('id')).first<Row>();
    if (!row || row.status !== 'pending') return c.json({ error: 'Proposal not found or already reviewed' }, 404);
    // Pemisahan tugas: pengusul tidak boleh meninjau usulannya sendiri.
    if (row.proposed_by === c.var.user.id && !c.var.user.isAdmin) return c.json({ error: 'A proposal must be reviewed by another organization owner' }, 403);
    const now = new Date();
    const at = now.toISOString();
    if (body.decision === 'reject') {
      await db.batch([
        db.prepare(`UPDATE org_changes SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?`).bind(c.var.user.id, at, body.note?.trim() || null, row.id),
        auditStatement(db, { at, actor: { type: 'user', id: c.var.user.id }, action: 'org_change_rejected', flowVersionId: 'org', detail: { changeId: row.id, note: body.note } }),
      ]);
      return c.json({ status: 'rejected' });
    }
    await db.prepare(`UPDATE org_changes SET status = 'scheduled', reviewed_by = ?, reviewed_at = ?, review_note = ? WHERE id = ?`).bind(c.var.user.id, at, body.note?.trim() || null, row.id).run();
    if ((row.effective_from as string) > at) return c.json({ status: 'scheduled', effectiveFrom: row.effective_from });
    const result = await applyChange(db, deps, { ...row, reviewed_by: c.var.user.id }, now);
    if (!result.ok) return c.json({ error: `Proposal could not be applied: ${result.error}` }, 409);
    return c.json({ status: 'applied', movedTasks: result.moved });
  });

  // Rantai atasan satu orang beserta alasan tiap tingkat, untuk menjawab "siapa approver saya".
  app.get('/chain/:id', async (c) => {
    const org = await loadOrg(c.env.DB);
    const directory = new InMemoryDirectory(org);
    const now = new Date();
    let current = org.users.find((u) => u.id === c.req.param('id'));
    if (!current) return c.json({ error: 'Person not found' }, 404);
    const chain: { userId: string; name: string; basis: string }[] = [];
    const seen = [current.id];
    let stop: string | undefined;
    while (chain.length < 8) {
      try {
        const up = await superiorOf(current, { directory, now }, seen);
        chain.push({ userId: up.user.id, name: up.user.name, basis: up.basis });
        seen.push(up.user.id);
        current = org.users.find((u) => u.id === up.user.id)!;
      } catch (e) {
        stop = e instanceof Error ? e.message : String(e);
        break;
      }
    }
    return c.json({ chain, stop });
  });

  // Uji cakupan: setiap orang dicoba sebagai pemohon di setiap alur yang berlaku.
  app.get('/coverage', async (c) => {
    const now = new Date();
    const [org, versions] = await Promise.all([loadOrg(c.env.DB), currentVersions(c.env.DB, now)]);
    const directory = new InMemoryDirectory(org);
    const flows = [];
    for (const v of versions) {
      const gaps = [];
      for (const user of org.users) gaps.push(...(await coverageGaps(v.definition, user, directory, now)));
      flows.push({ key: v.flowKey, name: v.definition.name, version: v.version, people: org.users.length, blocked: new Set(gaps.map((g) => g.userId)).size, gaps });
    }
    return c.json({ flows, names: Object.fromEntries(org.users.map((u) => [u.id, u.name])) });
  });

  // Admin sistem menunjuk pemilik master organisasi (minimal dua); admin sendiri tidak bisa menjadi pemilik.
  app.put('/owners', async (c) => {
    if (!c.var.user.isAdmin) return c.json({ error: 'System administrators only' }, 403);
    const { userIds } = await c.req.json<{ userIds: string[] }>();
    const ids = [...new Set(userIds ?? [])];
    if (ids.length < 2) return c.json({ error: 'The organization master needs at least two owners, so that every change is reviewed by a second person' }, 400);
    const db = c.env.DB;
    const { results } = await db.prepare(`SELECT id, is_admin FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<Row>();
    if (results.length !== ids.length) return c.json({ error: 'Some people were not found' }, 400);
    const at = new Date().toISOString();
    await db.batch([
      db.prepare('DELETE FROM org_owners'),
      ...ids.map((id) => db.prepare('INSERT INTO org_owners (user_id, assigned_by, assigned_at) VALUES (?, ?, ?)').bind(id, c.var.user.id, at)),
      auditStatement(db, { at, actor: { type: 'user', id: c.var.user.id }, action: 'org_owners_set', flowVersionId: 'org', detail: { userIds: ids } }),
    ]);
    return c.json({ ok: true });
  });

  // Isi awal: admin sistem mengimpor daftar unit (CSV: id,name,level,parent_id). Kepala unit tidak ikut diimpor.
  app.post('/import/units', async (c) => {
    if (!c.var.user.isAdmin) return c.json({ error: 'System administrators only' }, 403);
    const lines = (await c.req.text()).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const header = lines.shift()?.split(',').map((h) => h.trim());
    const need = ['id', 'name', 'level'];
    if (!header || need.some((h) => !header.includes(h))) return c.json({ error: `Required columns: ${need.join(', ')}` }, 400);
    const now = new Date();
    let org = await loadOrg(c.env.DB);
    const rows = lines.map((line) => {
      const cells = line.split(',').map((x) => x.trim());
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])) as Record<string, string>;
    });
    // Induk diimpor lebih dulu supaya urutan baris di file tidak penting.
    const rank = (r: Record<string, string>) => UNIT_LEVELS.indexOf(r.level as UnitLevel);
    rows.sort((a, b) => rank(a) - rank(b));
    const stmts: D1PreparedStatement[] = [];
    try {
      for (const r of rows) {
        if (!/^[a-z0-9_]+$/.test(r.id ?? '')) throw new ChangeError(`Invalid unit ID: ${r.id}`);
        const change: OrgChange = { kind: 'unit_upsert', id: r.id, name: r.name!, level: r.level as UnitLevel, parentId: r.parent_id || null };
        org = applyToSnapshot(org, change, now);
        stmts.push(...statements(c.env.DB, change, org));
      }
    } catch (e) {
      if (e instanceof ChangeError) return c.json({ error: e.message }, 400);
      throw e;
    }
    const at = now.toISOString();
    stmts.push(auditStatement(c.env.DB, { at, actor: { type: 'user', id: c.var.user.id }, action: 'org_units_imported', flowVersionId: 'org', detail: { count: rows.length } }));
    await c.env.DB.batch(stmts);
    return c.json({ imported: rows.length });
  });

  return app;
}
