import { UNIT_LEVELS, UNIT_LEVEL_LABEL, type UnitLevel } from './definition';
import { EngineError, type Directory, type DirectorySnapshot, type OrgUnit, type User } from './types';

// Siapa atasan seseorang tidak pernah disimpan per orang. Ia selalu dihitung
// dari pohon unit dengan urutan yang tetap, dan setiap hasil membawa alasannya:
//   1. pengecualian pelaporan yang masih berlaku,
//   2. kepala unit, atau pejabat sementara (Plt) kalau kepala kosong,
//   3. kalau tetap kosong, atau orangnya sendiri kepala, naik ke unit di atasnya.

export interface OrgContext {
  directory: Directory;
  now: Date;
  /** Alur yang sedang dirutekan; menentukan pengecualian mana yang berlaku. */
  flowKey?: string;
}

export interface Resolved {
  user: User;
  /** Penjelasan untuk manusia: kenapa orang ini yang ditunjuk. */
  basis: string;
}

const MAX_DEPTH = 16;

/** Kepala unit yang berlaku sekarang: kepala definitif, atau Plt yang belum lewat masanya. */
export function effectiveHead(unit: OrgUnit, now: Date): { userId: string; acting: boolean } | undefined {
  if (unit.headUserId) return { userId: unit.headUserId, acting: false };
  if (unit.actingHeadUserId && (!unit.actingUntil || now.toISOString() < unit.actingUntil)) {
    return { userId: unit.actingHeadUserId, acting: true };
  }
  return undefined;
}

/**
 * Naik dari `start` mencari kepala pertama yang bukan orang di `exclude`.
 * Unit tanpa kepala dilewati dan dicatat di alasan.
 */
async function climb(start: OrgUnit, exclude: Set<string>, ctx: OrgContext, subject: string): Promise<Resolved> {
  const notes: string[] = [];
  const seen = new Set<string>();
  let unit: OrgUnit | undefined = start;
  while (unit) {
    if (seen.has(unit.id) || seen.size >= MAX_DEPTH) {
      throw new EngineError('ROUTING', `Unit structure forms a loop around ${unit.name}`);
    }
    seen.add(unit.id);
    const head = effectiveHead(unit, ctx.now);
    if (!head) notes.push(`head of ${unit.name} is vacant`);
    else if (!exclude.has(head.userId)) {
      const user = await ctx.directory.getUser(head.userId);
      if (user) {
        const role = `${head.acting ? 'acting head of' : 'head of'} ${unit.name}`;
        return { user, basis: notes.length ? `${role}; escalated because ${notes.join(', ')}` : role };
      }
      notes.push(`head of ${unit.name} is not in the directory`);
    }
    unit = unit.parentId ? await ctx.directory.getUnit(unit.parentId) : undefined;
  }
  throw new EngineError('ROUTING', `No superior above ${subject}${notes.length ? ` (${notes.join(', ')})` : ''}`);
}

async function unitOf(user: User, directory: Directory): Promise<OrgUnit> {
  const unit = user.unitId ? await directory.getUnit(user.unitId) : undefined;
  if (!unit) throw new EngineError('ROUTING', `${user.name} is not placed in an organizational unit`);
  return unit;
}

/** Atasan langsung `person`. Orang di `exclude` tidak pernah dipilih; pencarian naik melewati mereka. */
export async function superiorOf(person: User, ctx: OrgContext, exclude: Iterable<string> = []): Promise<Resolved> {
  const skip = new Set([person.id, ...exclude]);
  const at = ctx.now.toISOString();
  const active = (await ctx.directory.getExceptions(person.id)).filter(
    (e) => e.startsAt <= at && at < e.endsAt && (!e.flowKey || e.flowKey === ctx.flowKey),
  );
  // Pengecualian khusus alur ini menang atas pengecualian umum.
  const exception = active.find((e) => e.flowKey) ?? active[0];
  if (exception && !skip.has(exception.toUserId)) {
    const user = await ctx.directory.getUser(exception.toUserId);
    if (user) return { user, basis: `reporting exception: ${exception.reason}` };
  }
  return climb(await unitOf(person, ctx.directory), skip, ctx, person.name);
}

/** Atasan `level` tingkat di atas `person` (1 = atasan langsung). */
export async function superiorAt(person: User, level: number, ctx: OrgContext, exclude: Iterable<string> = []): Promise<Resolved> {
  const skip = new Set(exclude);
  let current: Resolved = { user: person, basis: '' };
  for (let i = 1; i <= level; i++) {
    current = await superiorOf(current.user, ctx, [person.id, ...skip]);
    skip.add(current.user.id);
  }
  return level > 1 ? { user: current.user, basis: `superior ${level} levels up: ${current.basis}` } : current;
}

/**
 * Kepala unit pemohon pada tingkat `level`. Kalau pemohon tidak berada di bawah
 * unit setingkat itu, dipakai unit terdekat di atasnya.
 */
export async function unitHeadAt(person: User, level: UnitLevel, ctx: OrgContext, exclude: Iterable<string> = []): Promise<Resolved> {
  const target = UNIT_LEVELS.indexOf(level);
  let unit: OrgUnit | undefined = await unitOf(person, ctx.directory);
  const seen = new Set<string>();
  while (unit && UNIT_LEVELS.indexOf(unit.level) > target) {
    if (seen.has(unit.id) || seen.size >= MAX_DEPTH) throw new EngineError('ROUTING', `Unit structure forms a loop around ${unit.name}`);
    seen.add(unit.id);
    unit = unit.parentId ? await ctx.directory.getUnit(unit.parentId) : undefined;
  }
  if (!unit) {
    throw new EngineError('ROUTING', `${person.name} is not in a unit at ${UNIT_LEVEL_LABEL[level]} level or above`);
  }
  return climb(unit, new Set([person.id, ...exclude]), ctx, person.name);
}

/** Benar kalau `unitId` sama dengan `scopeUnitId` atau berada di bawahnya. */
export async function withinUnit(unitId: string | undefined, scopeUnitId: string, directory: Directory): Promise<boolean> {
  const seen = new Set<string>();
  let current = unitId;
  while (current && !seen.has(current) && seen.size < MAX_DEPTH) {
    if (current === scopeUnitId) return true;
    seen.add(current);
    current = (await directory.getUnit(current))?.parentId;
  }
  return false;
}

export interface OrgFinding {
  level: 'error' | 'warning';
  code:
    | 'UNIT_NO_HEAD'
    | 'ACTING_EXPIRED'
    | 'ACTING_HEAD'
    | 'USER_NO_UNIT'
    | 'UNIT_CYCLE'
    | 'UNIT_BAD_PARENT'
    | 'AUTHORITY_NO_HOLDER'
    | 'AUTHORITY_SINGLE_HOLDER'
    | 'EXCEPTION_EXPIRING'
    | 'HEAD_UNKNOWN';
  message: string;
  unitId?: string;
  userId?: string;
  authorityId?: string;
}

const DAY = 86_400_000;

/** Pemeriksaan kesehatan struktur: semua hal yang bisa membuat approver tidak jelas atau routing buntu. */
export function orgFindings(snapshot: DirectorySnapshot, now: Date, authorityIds: string[] = [], authorityNames: Record<string, string> = {}): OrgFinding[] {
  const out: OrgFinding[] = [];
  const units = new Map((snapshot.units ?? []).map((u) => [u.id, u]));
  const users = new Map(snapshot.users.map((u) => [u.id, u]));
  const at = now.toISOString();
  for (const unit of units.values()) {
    if (unit.parentId && !units.has(unit.parentId)) {
      out.push({ level: 'error', code: 'UNIT_BAD_PARENT', unitId: unit.id, message: `${unit.name}: parent unit not found` });
    }
    const seen = new Set<string>();
    for (let u: OrgUnit | undefined = unit; u; u = u.parentId ? units.get(u.parentId) : undefined) {
      if (seen.has(u.id)) {
        out.push({ level: 'error', code: 'UNIT_CYCLE', unitId: unit.id, message: `${unit.name}: its parent units form a loop` });
        break;
      }
      seen.add(u.id);
    }
    const head = effectiveHead(unit, now);
    if (head && !users.has(head.userId)) {
      out.push({ level: 'error', code: 'HEAD_UNKNOWN', unitId: unit.id, message: `${unit.name}: its head is not in the people list` });
    } else if (!head && unit.actingHeadUserId) {
      out.push({ level: 'error', code: 'ACTING_EXPIRED', unitId: unit.id, message: `${unit.name}: acting head's term has ended, the unit has no head` });
    } else if (!head) {
      out.push({ level: unit.parentId ? 'warning' : 'error', code: 'UNIT_NO_HEAD', unitId: unit.id, message: `${unit.name}: no head, approvals escalate to the unit above` });
    } else if (head.acting) {
      out.push({ level: 'warning', code: 'ACTING_HEAD', unitId: unit.id, message: `${unit.name}: led by an acting head${unit.actingUntil ? ` until ${unit.actingUntil.slice(0, 10)}` : ''}` });
    }
  }
  for (const user of snapshot.users) {
    if (!user.unitId || !units.has(user.unitId)) {
      out.push({ level: 'error', code: 'USER_NO_UNIT', userId: user.id, message: `${user.name}: not placed in a unit, so has no approval path` });
    }
  }
  for (const e of snapshot.exceptions ?? []) {
    if (e.startsAt <= at && at < e.endsAt && Date.parse(e.endsAt) - now.getTime() < 14 * DAY) {
      out.push({ level: 'warning', code: 'EXCEPTION_EXPIRING', userId: e.userId, message: `Reporting exception for ${users.get(e.userId)?.name ?? e.userId} ends ${e.endsAt.slice(0, 10)}` });
    }
  }
  for (const id of new Set([...authorityIds, ...Object.keys(snapshot.holders ?? {})])) {
    const holders = (snapshot.holders?.[id] ?? []).filter((h) => users.has(h.userId));
    const label = authorityNames[id] ?? id;
    if (holders.length === 0) out.push({ level: 'error', code: 'AUTHORITY_NO_HOLDER', authorityId: id, message: `Authority ${label}: no holder` });
    else if (holders.length === 1) out.push({ level: 'warning', code: 'AUTHORITY_SINGLE_HOLDER', authorityId: id, message: `Authority ${label}: only one holder, no backup` });
  }
  return out;
}
