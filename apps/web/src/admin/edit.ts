import { UNIT_LEVEL_LABEL, flattenSteps, type Condition, type FlowDefinition, type Step, type UnitLevel } from '@sentinel/engine/model';

/** Menunjuk satu urutan langkah: akar alur, atau salah satu cabang sebuah blok. */
export interface SeqRef {
  parent: string | null;
  branch: number | 'otherwise';
}

export const seqKey = (r: SeqRef) => `${r.parent ?? 'root'}/${r.branch}`;

function seqOf(def: FlowDefinition, ref: SeqRef): Step[] {
  if (ref.parent === null) return def.steps;
  const parent = flattenSteps(def.steps).find((s) => s.id === ref.parent);
  if (parent?.type === 'condition') return ref.branch === 'otherwise' ? parent.otherwise : parent.branches[ref.branch]!.steps;
  if (parent?.type === 'parallel' && ref.branch !== 'otherwise') return parent.branches[ref.branch]!;
  throw new Error(`Step sequence not found: ${seqKey(ref)}`);
}

const change = (def: FlowDefinition, fn: (draft: FlowDefinition) => void): FlowDefinition => {
  const next = structuredClone(def);
  fn(next);
  return next;
};

export function uniqueId(def: FlowDefinition, base: string): string {
  const used = new Set([...flattenSteps(def.steps).map((s) => s.id), ...def.tables.map((t) => t.id)]);
  let i = 1;
  while (used.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

export function newStep(def: FlowDefinition, type: Step['type']): Step {
  switch (type) {
    case 'approval':
      return { type, id: uniqueId(def, 'approval'), name: 'New approval', approver: { kind: 'manager', level: 1 }, slaHours: 24 };
    case 'notify':
      return { type, id: uniqueId(def, 'notif'), name: 'Notification', to: { kind: 'requester' }, message: 'Your request is being processed.' };
    case 'parallel':
      return { type, id: uniqueId(def, 'paralel'), name: 'Parallel', branches: [[], []] } as Step;
    case 'condition': {
      const field = def.fields[0]?.key ?? 'requester.department';
      const when: Condition[] = [{ field, op: 'eq', value: '' }];
      return { type, id: uniqueId(def, 'kondisi'), name: 'Condition', branches: [{ when, steps: [] }], otherwise: [] };
    }
  }
}

export const insertStep = (def: FlowDefinition, ref: SeqRef, index: number, step: Step) =>
  change(def, (d) => void seqOf(d, ref).splice(index, 0, step));

export const updateStep = (def: FlowDefinition, id: string, next: Step) =>
  change(def, (d) => {
    const visit = (steps: Step[]) => {
      steps.forEach((s, i) => {
        if (s.id === id) steps[i] = next;
        else if (s.type === 'condition') [...s.branches.map((b) => b.steps), s.otherwise].forEach(visit);
        else if (s.type === 'parallel') s.branches.forEach(visit);
      });
    };
    visit(d.steps);
  });

export const removeStep = (def: FlowDefinition, id: string) =>
  change(def, (d) => {
    const visit = (steps: Step[]) => {
      const i = steps.findIndex((s) => s.id === id);
      if (i >= 0) return void steps.splice(i, 1);
      for (const s of steps) {
        if (s.type === 'condition') [...s.branches.map((b) => b.steps), s.otherwise].forEach(visit);
        else if (s.type === 'parallel') s.branches.forEach(visit);
      }
    };
    visit(d.steps);
  });

const OPS: Record<string, string> = { eq: '=', neq: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤', in: 'one of' };

/** Kondisi sebagai bagian terpisah (bidang, operator, nilai batas) untuk ditampilkan sebagai batas spesifikasi. */
export function conditionParts(def: FlowDefinition, when: Condition[]): { label: string; op: string; value: string }[] {
  return when.map((c) => ({
    label: c.field === 'requester.department' ? 'Requester department' : (def.fields.find((f) => f.key === c.field)?.label ?? c.field),
    op: OPS[c.op] ?? c.op,
    value: Array.isArray(c.value) ? c.value.join(', ') : typeof c.value === 'number' ? c.value.toLocaleString('en-US') : String(c.value),
  }));
}

export function conditionText(def: FlowDefinition, when: Condition[]): string {
  if (when.length === 0) return 'otherwise';
  return when
    .map((c) => {
      const label = c.field === 'requester.department' ? 'Requester department' : (def.fields.find((f) => f.key === c.field)?.label ?? c.field);
      const value = Array.isArray(c.value) ? c.value.join(', ') : typeof c.value === 'number' ? c.value.toLocaleString('en-US') : String(c.value);
      return `${label} ${OPS[c.op]} ${value}`;
    })
    .join(' and ');
}

/** Nama wewenang dari master organisasi; diisi editor setelah memuat versi alur. */
let authorityNames: Record<string, string> = {};
export const setAuthorityNames = (names: Record<string, string>) => {
  authorityNames = names;
};
export const roleLabel = (role?: string) => (role ? (authorityNames[role] ?? role.replace(/_/g, ' ')) : '');

export function approverText(a: { kind: string; level?: number | string; role?: string; userId?: string; tableId?: string }, def: FlowDefinition): string {
  switch (a.kind) {
    case 'manager':
      return a.level === 1 ? 'Direct superior' : `Level ${a.level} superior`;
    case 'role':
      return `Authority: ${roleLabel(a.role)}`;
    case 'unit_head':
      return `Head of the requester's ${UNIT_LEVEL_LABEL[a.level as UnitLevel]?.toLowerCase() ?? a.level}`;
    case 'user':
      return `User: ${a.userId}`;
    case 'table':
      return `Table: ${def.tables.find((t) => t.id === a.tableId)?.name ?? a.tableId}`;
    case 'requester':
      return 'Requester';
    default:
      return 'Not required';
  }
}
