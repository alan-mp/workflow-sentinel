import type { ApproverSpec, DirectApprover, Field, FlowDefinition, Step } from './definition';
import { superiorAt, superiorOf, unitHeadAt, withinUnit, type OrgContext } from './org';
import { firstMatch, type Facts } from './rules';
import { EngineError, type Directory, type User } from './types';

export function validateData(fields: Field[], data: Record<string, unknown>): void {
  const known = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(data)) {
    if (!known.has(key)) throw new EngineError('INVALID_DATA', `Field tidak dikenal: ${key}`);
  }
  for (const f of fields) {
    const v = data[f.key];
    if (v === undefined || v === null) {
      if (!f.optional) throw new EngineError('INVALID_DATA', `Field wajib kosong: ${f.key}`);
      continue;
    }
    const ok =
      f.type === 'date'
        ? typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)
        : f.type === 'number'
          ? typeof v === 'number' && Number.isFinite(v)
          : typeof v === f.type;
    if (!ok) throw new EngineError('INVALID_DATA', `Field ${f.key} harus bertipe ${f.type}`);
  }
}

export interface Resolution {
  /** Kosong berarti langkah dilewati oleh baris tabel ber-approver "none". */
  assignees: string[];
  skipped: boolean;
  tableRow?: { tableId: string; rowId: string };
  /** Pemohon dikeluarkan dari daftar approver (pemisahan tugas). */
  requesterExcluded: boolean;
  /** Pemohon satu-satunya approver, jadi dialihkan ke atasannya. */
  reroutedToManager: boolean;
  /** Penjelasan untuk manusia: kenapa approver ini yang ditunjuk. */
  basis?: string;
}

export interface ResolveInput {
  definition: FlowDefinition;
  requester: User;
  facts: Facts;
  directory: Directory;
  /** Waktu routing; menentukan Plt dan pengecualian yang berlaku. Bawaan: sekarang. */
  now?: Date;
  /** Orang yang sudah menyetujui tahap sebelumnya pada putaran ini. */
  alreadyApproved?: string[];
}

interface Candidates {
  ids: string[];
  basis: string;
  /** Ditentukan dari struktur organisasi, bukan dari wewenang atau penunjukan. */
  structural: boolean;
}

async function resolveCandidates(spec: DirectApprover, requester: User, ctx: OrgContext, exclude: string[] = []): Promise<Candidates> {
  switch (spec.kind) {
    case 'manager': {
      const r = await superiorAt(requester, spec.level, ctx, exclude);
      return { ids: [r.user.id], basis: r.basis, structural: true };
    }
    case 'unit_head': {
      const r = await unitHeadAt(requester, spec.level, ctx, exclude);
      return { ids: [r.user.id], basis: r.basis, structural: true };
    }
    case 'role': {
      const ids: string[] = [];
      for (const h of await ctx.directory.getAuthorityHolders(spec.role)) {
        if (h.scopeUnitId && !(await withinUnit(requester.unitId, h.scopeUnitId, ctx.directory))) continue;
        if ((await ctx.directory.getUser(h.userId)) && !ids.includes(h.userId)) ids.push(h.userId);
      }
      if (ids.length === 0) throw new EngineError('ROUTING', `Tidak ada pemegang wewenang ${spec.role} untuk unit pemohon`);
      return { ids, basis: `pemegang wewenang ${spec.role}`, structural: false };
    }
    case 'user': {
      if (!(await ctx.directory.getUser(spec.userId))) {
        throw new EngineError('ROUTING', `User ${spec.userId} tidak ditemukan`);
      }
      return { ids: [spec.userId], basis: 'ditunjuk langsung di alur', structural: false };
    }
  }
}

export async function resolveDirect(
  spec: DirectApprover,
  requester: User,
  directory: Directory,
  options: { now?: Date; flowKey?: string } = {},
): Promise<string[]> {
  return (await resolveCandidates(spec, requester, { directory, now: options.now ?? new Date(), flowKey: options.flowKey })).ids;
}

/**
 * Menentukan approver sebuah langkah beserta alasannya. Dua jaminan berlaku
 * apa pun isi alurnya: pemohon tidak pernah menjadi approver permintaannya
 * sendiri, dan approver dari jalur struktur tidak mengulang orang yang sudah
 * menyetujui tahap sebelumnya selama masih ada atasan di atasnya.
 */
export async function resolveApprovers(spec: ApproverSpec, input: ResolveInput): Promise<Resolution> {
  const { definition, requester, facts, directory } = input;
  const ctx: OrgContext = { directory, now: input.now ?? new Date(), flowKey: definition.key };
  let direct: DirectApprover;
  let tableRow: Resolution['tableRow'];

  if (spec.kind === 'table') {
    const table = definition.tables.find((t) => t.id === spec.tableId);
    if (!table) throw new EngineError('ROUTING', `Tabel aturan ${spec.tableId} tidak ada`);
    const hit = await firstMatch(table.rows, facts);
    const row = hit === undefined ? undefined : table.rows[hit];
    if (!row) throw new EngineError('ROUTING', `Tidak ada baris yang cocok di tabel ${table.id}`);
    tableRow = { tableId: table.id, rowId: row.id };
    if (row.approver.kind === 'none') {
      return { assignees: [], skipped: true, tableRow, requesterExcluded: false, reroutedToManager: false };
    }
    direct = row.approver;
  } else {
    direct = spec;
  }

  let found = await resolveCandidates(direct, requester, ctx);
  const repeated = found.structural ? found.ids.find((id) => input.alreadyApproved?.includes(id)) : undefined;
  if (repeated) {
    try {
      const higher = await resolveCandidates(direct, requester, ctx, input.alreadyApproved);
      const name = (await directory.getUser(repeated))?.name ?? repeated;
      found = { ...higher, basis: `${higher.basis}; naik karena ${name} sudah menyetujui tahap sebelumnya` };
    } catch (e) {
      // Tidak ada lagi atasan di atasnya: orang yang sama tetap menjadi approver.
      if (!(e instanceof EngineError)) throw e;
    }
  }

  const others = found.ids.filter((id) => id !== requester.id);
  const requesterExcluded = others.length !== found.ids.length;
  if (others.length > 0) {
    return { assignees: others, skipped: false, tableRow, requesterExcluded, reroutedToManager: false, basis: found.basis };
  }
  const manager = await superiorOf(requester, ctx);
  return {
    assignees: [manager.user.id],
    skipped: false,
    tableRow,
    requesterExcluded: true,
    reroutedToManager: true,
    basis: `${manager.basis}; dialihkan karena pemohon satu-satunya ${found.basis}`,
  };
}

export interface WalkHandler {
  /** Kembalikan true kalau langkah sudah selesai, false kalau masih menunggu. */
  approval(step: Extract<Step, { type: 'approval' }>): Promise<boolean>;
  notify(step: Extract<Step, { type: 'notify' }>): Promise<void>;
  parallel?(step: Extract<Step, { type: 'parallel' }>, phase: 'enter' | 'exit'): void;
}

/**
 * Menelusuri langkah dari awal. Dipakai oleh eksekusi dan simulasi, sehingga
 * simulasi selalu mengikuti jalur yang sama dengan produksi.
 * Mengembalikan true kalau semua langkah selesai.
 */
export async function walk(steps: Step[], facts: Facts, handler: WalkHandler): Promise<boolean> {
  for (const step of steps) {
    switch (step.type) {
      case 'approval':
        if (!(await handler.approval(step))) return false;
        break;
      case 'notify':
        await handler.notify(step);
        break;
      case 'condition': {
        const hit = await firstMatch(step.branches, facts);
        const branch = hit === undefined ? undefined : step.branches[hit];
        if (!(await walk(branch ? branch.steps : step.otherwise, facts, handler))) return false;
        break;
      }
      case 'parallel': {
        handler.parallel?.(step, 'enter');
        let allDone = true;
        for (const branch of step.branches) {
          if (!(await walk(branch, facts, handler))) allDone = false;
        }
        handler.parallel?.(step, 'exit');
        if (!allDone) return false;
        break;
      }
    }
  }
  return true;
}
