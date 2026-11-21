import { describe, expect, it } from 'vitest';
import { simulate, validateDefinition } from '../src/index';
import { definition, directory } from './helpers';

const route = async (flow: string, requesterId: string, data: Record<string, unknown>) =>
  (await simulate(definition(flow), { requesterId, data }, directory))
    .filter((s) => s.type === 'approval' && !s.skipped)
    .map((s) => [s.stepId, s.userIds]);

const purchase = (amount: number, category: string) => ({ amount, category, description: 'x' });

describe('aturan routing', () => {
  it('pembelian kecil non-teknis hanya ke atasan', async () => {
    expect(await route('purchase', 'u_budi', purchase(2_000_000, 'atk'))).toEqual([['atasan', ['u_maya']]]);
  });

  it('batas nominal: tepat Rp10 juta sudah masuk keuangan, di bawahnya belum', async () => {
    expect(await route('purchase', 'u_budi', purchase(9_999_999, 'atk'))).toHaveLength(1);
    expect(await route('purchase', 'u_budi', purchase(10_000_000, 'atk'))).toEqual([
      ['atasan', ['u_maya']],
      ['keuangan', ['u_fajar']],
    ]);
  });

  it('kategori menentukan approver teknis', async () => {
    expect(await route('purchase', 'u_budi', purchase(1_000_000, 'it'))).toContainEqual(['teknis', ['u_irfan']]);
    expect(await route('purchase', 'u_budi', purchase(1_000_000, 'sparepart'))).toContainEqual([
      'teknis',
      ['u_putra'],
    ]);
  });

  it('Rp100 juta ke atas sampai ke direktur', async () => {
    expect(await route('purchase', 'u_budi', purchase(100_000_000, 'mesin'))).toEqual([
      ['atasan', ['u_maya']],
      ['keuangan', ['u_fajar']],
      ['teknis', ['u_putra']],
      ['direktur', ['u_dewi']],
    ]);
  });

  it('baris pertama yang cocok dipakai dan dicatat', async () => {
    const steps = await simulate(
      definition('purchase'),
      { requesterId: 'u_budi', data: purchase(50_000_000, 'it') },
      directory,
    );
    expect(steps.find((s) => s.stepId === 'keuangan')?.tableRow).toEqual({
      tableId: 'approver_keuangan',
      rowId: '10jt_ke_atas',
    });
    expect(steps.find((s) => s.stepId === 'keuangan')?.parallelIn).toBe('keuangan_dan_teknis');
  });

  it('cuti: lebih dari 5 hari naik ke atasan tingkat 2', async () => {
    const leave = (days: number) => ({
      leave_type: 'tahunan',
      start_date: '2026-12-10',
      end_date: '2026-12-20',
      days,
    });
    expect(await route('leave', 'u_budi', leave(5))).toEqual([['atasan', ['u_maya']]]);
    expect(await route('leave', 'u_budi', leave(6))).toEqual([
      ['atasan', ['u_maya']],
      ['atasan_2', ['u_putra']],
    ]);
  });

  it('akses IT: pemilik sistem dari tabel, admin menambah IT Security', async () => {
    const data = { system: 'erp', access_level: 'admin', justification: 'x' };
    expect(await route('it_access', 'u_budi', data)).toEqual([
      ['atasan', ['u_maya']],
      ['pemilik', ['u_irfan']],
      ['security', ['u_sari']],
    ]);
  });

  it('simulasi menampilkan masalah routing, bukan menebak', async () => {
    const def = definition('leave');
    const steps = await simulate(
      def,
      { requesterId: 'u_dewi', data: { leave_type: 'x', start_date: '2026-12-10', end_date: '2026-12-11', days: 1 } },
      directory,
    );
    expect(steps[0]?.error).toMatch(/Atasan tingkat 1/);
  });
});

describe('validasi definisi', () => {
  it('tiga alur contoh valid', () => {
    for (const flow of ['leave', 'it_access', 'purchase']) {
      expect(validateDefinition(definition(flow)).issues).toEqual([]);
    }
  });

  it('menolak tabel tanpa baris default', () => {
    const def = definition('purchase');
    def.tables[0]!.rows.pop();
    expect(validateDefinition(def).issues.map((i) => i.code)).toContain('TABLE_NO_DEFAULT');
  });

  it('menolak jalur yang bisa selesai tanpa approval', () => {
    const def = definition('purchase');
    def.steps.shift(); // buang langkah atasan; sisanya bisa dilewati semua
    expect(validateDefinition(def).issues.map((i) => i.code)).toContain('PATH_WITHOUT_APPROVAL');
  });

  it('menolak rujukan ke field, tabel, atau operator yang salah', () => {
    const def = definition('purchase');
    def.tables[0]!.rows[0]!.when[0]!.field = 'nominal';
    def.tables[1]!.rows[0]!.when[0]!.op = 'gt';
    (def.steps[0] as { approver: unknown }).approver = { kind: 'table', tableId: 'tidak_ada' };
    const codes = validateDefinition(def).issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['UNKNOWN_FIELD', 'BAD_OPERATOR', 'UNKNOWN_TABLE']));
  });

  it('menolak jenis blok di luar empat yang diizinkan', () => {
    const def = definition('leave') as unknown as { steps: unknown[] };
    def.steps.push({ type: 'auto_approve', id: 'x', name: 'x' });
    expect(validateDefinition(def).ok).toBe(false);
  });
});
