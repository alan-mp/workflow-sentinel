import {
  BUILTIN_FIELDS,
  FlowDefinitionSchema,
  type Condition,
  type Field,
  type FlowDefinition,
  type Step,
} from './definition';

export interface Issue {
  level: 'error' | 'warning';
  code: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  definition?: FlowDefinition;
  issues: Issue[];
}

/**
 * Pemeriksaan sebelum sebuah definisi boleh diaktifkan: bentuk data, rujukan,
 * dan jaminan bahwa tidak ada jalur yang lolos tanpa approval manusia.
 */
export function validateDefinition(input: unknown): ValidationResult {
  const parsed = FlowDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({
        level: 'error',
        code: 'SCHEMA',
        message: `${i.path.join('.')}: ${i.message}`,
      })),
    };
  }
  const def = parsed.data as FlowDefinition;
  const issues: Issue[] = [];
  const err = (code: string, message: string) => issues.push({ level: 'error', code, message });
  const warn = (code: string, message: string) => issues.push({ level: 'warning', code, message });

  const fieldTypes = new Map<string, Field['type']>(Object.entries(BUILTIN_FIELDS));
  for (const f of def.fields) {
    if (fieldTypes.has(f.key)) err('DUPLICATE_FIELD', `Field ganda: ${f.key}`);
    fieldTypes.set(f.key, f.type);
  }

  const checkConditions = (conds: Condition[], where: string) => {
    for (const c of conds) {
      const type = fieldTypes.get(c.field);
      if (!type) {
        err('UNKNOWN_FIELD', `${where}: field ${c.field} tidak ada`);
        continue;
      }
      const ordered = ['gt', 'gte', 'lt', 'lte'].includes(c.op);
      if (ordered && type !== 'number' && type !== 'date') {
        err('BAD_OPERATOR', `${where}: operator ${c.op} hanya untuk angka atau tanggal (${c.field})`);
      }
      if ((c.op === 'in') !== Array.isArray(c.value)) {
        err('BAD_VALUE', `${where}: operator "in" memakai daftar nilai, operator lain satu nilai (${c.field})`);
        continue;
      }
      const expected = type === 'date' ? 'string' : type;
      const values = Array.isArray(c.value) ? c.value : [c.value];
      if (values.some((v) => typeof v !== expected)) {
        err('BAD_VALUE', `${where}: nilai untuk ${c.field} harus bertipe ${type}`);
      }
    }
  };

  const tableIds = new Set<string>();
  /** Tabel yang punya baris "none", sehingga langkahnya bisa dilewati. */
  const skippableTables = new Set<string>();
  for (const t of def.tables) {
    if (tableIds.has(t.id)) err('DUPLICATE_TABLE', `Tabel ganda: ${t.id}`);
    tableIds.add(t.id);
    const rowIds = new Set<string>();
    t.rows.forEach((r, i) => {
      if (rowIds.has(r.id)) err('DUPLICATE_ROW', `Tabel ${t.id}: baris ganda ${r.id}`);
      rowIds.add(r.id);
      checkConditions(r.when, `Tabel ${t.id} baris ${r.id}`);
      if (r.approver.kind === 'none') skippableTables.add(t.id);
      if (r.when.length === 0 && i < t.rows.length - 1) {
        warn('UNREACHABLE_ROW', `Tabel ${t.id}: baris setelah ${r.id} tidak akan pernah dipakai`);
      }
    });
    if (t.rows[t.rows.length - 1]!.when.length > 0) {
      err('TABLE_NO_DEFAULT', `Tabel ${t.id}: baris terakhir harus baris default (tanpa kondisi)`);
    }
  }

  const stepIds = new Set<string>();
  const visit = (steps: Step[]) => {
    for (const s of steps) {
      if (stepIds.has(s.id)) err('DUPLICATE_STEP', `Langkah ganda: ${s.id}`);
      stepIds.add(s.id);
      if (s.type === 'approval' && s.approver.kind === 'table' && !tableIds.has(s.approver.tableId)) {
        err('UNKNOWN_TABLE', `Langkah ${s.id}: tabel ${s.approver.tableId} tidak ada`);
      }
      if (s.type === 'condition') {
        s.branches.forEach((b) => {
          checkConditions(b.when, `Langkah ${s.id}`);
          visit(b.steps);
        });
        visit(s.otherwise);
      }
      if (s.type === 'parallel') s.branches.forEach(visit);
    }
  };
  visit(def.steps);

  /** Benar kalau setiap jalur lewat `steps` pasti melewati approval manusia. */
  const guaranteed = (steps: Step[]): boolean =>
    steps.some((s) => {
      switch (s.type) {
        case 'approval':
          return s.approver.kind !== 'table' || !skippableTables.has(s.approver.tableId);
        case 'condition':
          return s.branches.every((b) => guaranteed(b.steps)) && guaranteed(s.otherwise);
        case 'parallel':
          return s.branches.some(guaranteed);
        case 'notify':
          return false;
      }
    });
  if (!guaranteed(def.steps)) {
    err('PATH_WITHOUT_APPROVAL', 'Ada jalur yang bisa selesai tanpa approval manusia');
  }

  const ok = !issues.some((i) => i.level === 'error');
  return { ok, definition: ok ? def : undefined, issues };
}
