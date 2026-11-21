import type { ApproverSpec, Condition, DirectApprover, Field, FlowDefinition, Step } from './definition';
import { EngineError, type Directory, type User } from './types';

export type Facts = Record<string, unknown>;

export function buildFacts(data: Record<string, unknown>, requester: User): Facts {
  return { ...data, 'requester.department': requester.department };
}

/** Semua kondisi harus terpenuhi. Field yang kosong tidak pernah cocok. */
export function matches(conditions: Condition[], facts: Facts): boolean {
  return conditions.every((c) => {
    const actual = facts[c.field];
    if (actual === undefined || actual === null) return false;
    switch (c.op) {
      case 'eq':
        return actual === c.value;
      case 'neq':
        return actual !== c.value;
      case 'in':
        return Array.isArray(c.value) && c.value.includes(actual as never);
      case 'gt':
        return (actual as never) > (c.value as never);
      case 'gte':
        return (actual as never) >= (c.value as never);
      case 'lt':
        return (actual as never) < (c.value as never);
      case 'lte':
        return (actual as never) <= (c.value as never);
    }
  });
}

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
}

export interface ResolveInput {
  definition: FlowDefinition;
  requester: User;
  facts: Facts;
  directory: Directory;
}

async function managerAt(requester: User, level: number, directory: Directory): Promise<User> {
  let current = requester;
  for (let i = 0; i < level; i++) {
    const next = current.managerId ? await directory.getUser(current.managerId) : undefined;
    if (!next) {
      throw new EngineError('ROUTING', `Atasan tingkat ${i + 1} dari ${requester.id} tidak ditemukan`);
    }
    current = next;
  }
  return current;
}

export async function resolveDirect(
  spec: DirectApprover,
  requester: User,
  directory: Directory,
): Promise<string[]> {
  switch (spec.kind) {
    case 'manager':
      return [(await managerAt(requester, spec.level, directory)).id];
    case 'role': {
      const users = await directory.getUsersByRole(spec.role);
      if (users.length === 0) throw new EngineError('ROUTING', `Tidak ada pemegang peran ${spec.role}`);
      return users.map((u) => u.id);
    }
    case 'user': {
      if (!(await directory.getUser(spec.userId))) {
        throw new EngineError('ROUTING', `User ${spec.userId} tidak ditemukan`);
      }
      return [spec.userId];
    }
  }
}

/**
 * Menentukan approver sebuah langkah. Pemohon tidak pernah menjadi approver
 * permintaannya sendiri: ia dikeluarkan dari daftar, dan kalau ia satu-satunya
 * kandidat, langkah dialihkan ke atasan langsungnya.
 */
export async function resolveApprovers(spec: ApproverSpec, input: ResolveInput): Promise<Resolution> {
  const { definition, requester, facts, directory } = input;
  let direct: DirectApprover;
  let tableRow: Resolution['tableRow'];

  if (spec.kind === 'table') {
    const table = definition.tables.find((t) => t.id === spec.tableId);
    if (!table) throw new EngineError('ROUTING', `Tabel aturan ${spec.tableId} tidak ada`);
    const row = table.rows.find((r) => matches(r.when, facts));
    if (!row) throw new EngineError('ROUTING', `Tidak ada baris yang cocok di tabel ${table.id}`);
    tableRow = { tableId: table.id, rowId: row.id };
    if (row.approver.kind === 'none') {
      return { assignees: [], skipped: true, tableRow, requesterExcluded: false, reroutedToManager: false };
    }
    direct = row.approver;
  } else {
    direct = spec;
  }

  const candidates = await resolveDirect(direct, requester, directory);
  const others = candidates.filter((id) => id !== requester.id);
  const requesterExcluded = others.length !== candidates.length;
  if (others.length > 0) {
    return { assignees: others, skipped: false, tableRow, requesterExcluded, reroutedToManager: false };
  }
  const manager = await managerAt(requester, 1, directory);
  return {
    assignees: [manager.id],
    skipped: false,
    tableRow,
    requesterExcluded: true,
    reroutedToManager: true,
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
        const branch = step.branches.find((b) => matches(b.when, facts));
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
