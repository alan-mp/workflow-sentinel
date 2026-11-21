import { describe, expect, it } from 'vitest';
import {
  EngineError,
  activateVersion,
  assertCompilable,
  buildFacts,
  createDraft,
  firstMatch,
  matches,
  resolveApprovers,
  type Condition,
  type Field,
  type FlowDefinition,
} from '../src/index';
import { definition, directory, users } from './helpers';

const fields: Field[] = [
  { key: 'amount', label: 'Nominal', type: 'number' },
  { key: 'category', label: 'Kategori', type: 'string' },
  { key: 'urgent', label: 'Mendesak', type: 'boolean', optional: true },
  { key: 'needed_by', label: 'Dibutuhkan', type: 'date', optional: true },
];
const budi = users.find((u) => u.id === 'u_budi')!;
const facts = (data: Record<string, unknown>) => buildFacts(fields, data, budi);

/** Semantik acuan dari mesin lama, dipakai hanya untuk membuktikan hasil engine tidak berubah. */
function reference(when: Condition[], data: Record<string, unknown>): boolean {
  const all: Record<string, unknown> = { ...data, 'requester.department': budi.department };
  return when.every((c) => {
    const actual = all[c.field];
    if (actual === undefined || actual === null) return false;
    switch (c.op) {
      case 'eq':
        return actual === c.value;
      case 'neq':
        return actual !== c.value;
      case 'in':
        return (c.value as unknown[]).includes(actual);
      case 'gt':
        return (actual as number) > (c.value as number);
      case 'gte':
        return (actual as number) >= (c.value as number);
      case 'lt':
        return (actual as number) < (c.value as number);
      case 'lte':
        return (actual as number) <= (c.value as number);
    }
  });
}

describe('evaluasi aturan oleh json-rules-engine', () => {
  it('hasilnya sama dengan semantik acuan untuk seluruh kombinasi operator dan nilai', async () => {
    const amounts = [0, 9_999_999, 10_000_000, 10_000_001, 100_000_000];
    const conditions: Condition[] = [
      ...(['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const).map((op) => ({ field: 'amount', op, value: 10_000_000 })),
      { field: 'amount', op: 'in', value: [0, 100_000_000] },
      { field: 'category', op: 'eq', value: 'it' },
      { field: 'category', op: 'neq', value: 'it' },
      { field: 'category', op: 'in', value: ['mesin', 'sparepart'] },
      { field: 'urgent', op: 'eq', value: true },
      { field: 'urgent', op: 'neq', value: true },
      { field: 'needed_by', op: 'gte', value: '2026-12-15' },
      { field: 'needed_by', op: 'lt', value: '2026-12-15' },
      { field: 'requester.department', op: 'eq', value: 'produksi' },
      { field: 'requester.department', op: 'in', value: ['it', 'hr'] },
    ];
    let checked = 0;
    for (const amount of amounts) {
      for (const category of ['it', 'mesin', 'atk']) {
        for (const urgent of [true, false, undefined]) {
          for (const needed_by of ['2026-12-14', '2026-12-15', '2026-12-16', undefined]) {
            const data = { amount, category, urgent, needed_by };
            const f = facts(data);
            for (const a of conditions) {
              expect(await matches([a], f), `${JSON.stringify(a)} @ ${JSON.stringify(data)}`).toBe(reference([a], data));
              for (const b of conditions) {
                expect(await matches([a, b], f)).toBe(reference([a, b], data));
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(40_000);
  });

  it('memilih baris pertama yang cocok walau baris berikutnya juga cocok', async () => {
    const rows = [
      { when: [{ field: 'amount', op: 'lt', value: 10_000_000 } as Condition] },
      { when: [{ field: 'amount', op: 'lt', value: 50_000_000 } as Condition] },
      { when: [] },
    ];
    expect(await firstMatch(rows, facts({ amount: 5, category: 'atk' }))).toBe(0);
    expect(await firstMatch(rows, facts({ amount: 20_000_000, category: 'atk' }))).toBe(1);
    expect(await firstMatch(rows, facts({ amount: 90_000_000, category: 'atk' }))).toBe(2);
    expect(await firstMatch(rows.slice(0, 2), facts({ amount: 90_000_000, category: 'atk' }))).toBeUndefined();
  });

  it('field opsional yang kosong tidak pernah cocok, termasuk untuk "tidak sama dengan"', async () => {
    const f = facts({ amount: 1, category: 'atk' });
    expect(await matches([{ field: 'urgent', op: 'neq', value: true }], f)).toBe(false);
    expect(await matches([{ field: 'needed_by', op: 'lt', value: '2030-01-01' }], f)).toBe(false);
  });

  it('menolak fakta bertipe salah alih-alih membandingkannya', () => {
    expect(() => facts({ amount: '5', category: 'atk' })).toThrowError(EngineError);
    expect(() => facts({ amount: Number.NaN, category: 'atk' })).toThrowError(EngineError);
    expect(() => facts({ amount: 1, category: 'atk', needed_by: 'besok' })).toThrowError(/valid date/);
  });

  it('gagal-aman: kondisi yang merujuk field tak dikenal menghentikan routing', async () => {
    const f = facts({ amount: 1, category: 'atk' });
    await expect(matches([{ field: 'tidak_ada', op: 'eq', value: 1 }], f)).rejects.toMatchObject({ code: 'INVALID_DEFINITION' });
    await expect(matches([{ field: 'amount', op: 'lt', value: 'sepuluh' }], f)).rejects.toMatchObject({ code: 'INVALID_DEFINITION' });
  });

  it('tabel aturan contoh pembelian tetap memilih baris yang sama', async () => {
    const def = definition('purchase');
    const resolve = async (data: Record<string, unknown>, tableId: string) =>
      (await resolveApprovers({ kind: 'table', tableId }, { definition: def, requester: budi, facts: buildFacts(def.fields, data, budi), directory })).tableRow?.rowId;
    expect(await resolve({ amount: 9_999_999, category: 'atk', description: 'x' }, 'approver_keuangan')).toBe('di_bawah_10jt');
    expect(await resolve({ amount: 10_000_000, category: 'atk', description: 'x' }, 'approver_keuangan')).toBe('10jt_ke_atas');
    expect(await resolve({ amount: 1, category: 'sparepart', description: 'x' }, 'approver_kategori')).toBe('mesin');
    expect(await resolve({ amount: 1, category: 'atk', description: 'x' }, 'approver_kategori')).toBe('lainnya');
  });

  it('semua definisi contoh bisa dimuat engine, dan definisi rusak ditolak saat aktivasi', () => {
    for (const name of ['leave', 'it_access', 'purchase']) expect(() => assertCompilable(definition(name))).not.toThrow();
    const broken: FlowDefinition = structuredClone(definition('purchase'));
    broken.tables[0]!.rows[0]!.when[0]!.value = 'sepuluh juta';
    const draft = createDraft({ id: 'p-v9', flowKey: 'purchase', version: 9, definition: broken, createdBy: 'u_hana', sopUrl: 'https://example.test/sop.pdf' });
    expect(() =>
      activateVersion(draft, { actor: { type: 'user', id: 'u_dewi' }, effectiveFrom: '2026-11-01T00:00:00.000Z', now: new Date('2026-11-01T00:00:00.000Z') }),
    ).toThrowError(EngineError);
  });
});
