import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { amountField, amountThresholds, detectAnomalies, type PastRequest } from '../src';
import type { FlowDefinition } from '../src/definition';

const def: FlowDefinition = JSON.parse(readFileSync(new URL('../examples/purchase.json', import.meta.url), 'utf8'));
const NOW = '2026-11-21T10:00:00Z';
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const past = (id: string, amount: number, extra: Partial<PastRequest> = {}, category = 'atk'): PastRequest => ({
  id,
  requesterId: 'u_budi',
  data: { amount, category, description: id },
  createdAt: daysAgo(3),
  status: 'approved',
  ...extra,
});
const current = (amount: number, category = 'atk', data: Record<string, unknown> = {}) => ({
  id: 'REQ-NOW',
  requesterId: 'u_budi',
  data: { amount, category, description: 'Kertas', ...data },
  createdAt: NOW,
});

describe('deteksi anomali', () => {
  it('membaca ambang dari aturan alur itu sendiri', () => {
    expect(amountThresholds(def, 'amount')).toEqual([10_000_000, 100_000_000]);
  });

  it('menandai pembelian yang dipecah di bawah ambang', () => {
    const out = detectAnomalies({ definition: def, current: current(6_000_000), history: [past('REQ-A', 5_000_000)] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'split_below_threshold', related: ['REQ-A'], detail: { limit: 10_000_000, total: 11_000_000 } });
    expect(out[0]!.message).toContain('10,000,000');
  });

  it('tidak menandai bila jumlahnya tidak mencapai ambang, beda kategori, beda orang, ditolak, atau di luar jendela waktu', () => {
    const history = [
      past('REQ-SMALL', 1_000_000),
      past('REQ-OTHERCAT', 5_000_000, {}, 'it'),
      past('REQ-OTHER', 5_000_000, { requesterId: 'u_maya' }),
      past('REQ-REJ', 5_000_000, { status: 'rejected' }),
      past('REQ-OLD', 5_000_000, { createdAt: daysAgo(30) }),
    ];
    expect(detectAnomalies({ definition: def, current: current(6_000_000), history }).map((a) => a.kind)).toEqual([]);
  });

  it('menandai nominal jauh di atas kebiasaan kategori', () => {
    const history = [1, 2, 3, 4, 5].map((i) => past(`REQ-${i}`, 2_000_000, { requesterId: `u_${i}` }));
    const out = detectAnomalies({ definition: def, current: current(9_000_000), history });
    expect(out.map((a) => a.kind)).toEqual(['amount_outlier']);
    expect(out[0]!.detail).toMatchObject({ median: 2_000_000, samples: 5 });
  });

  it('tidak menilai kebiasaan dari terlalu sedikit data', () => {
    const history = [1, 2, 3].map((i) => past(`REQ-${i}`, 2_000_000, { requesterId: `u_${i}` }));
    expect(detectAnomalies({ definition: def, current: current(9_000_000), history })).toEqual([]);
  });

  it('menandai pengajuan ganda dengan isi yang sama persis', () => {
    const same = current(1_000_000);
    const out = detectAnomalies({ definition: def, current: same, history: [past('REQ-DUP', 1_000_000, { data: { ...same.data } })] });
    expect(out.map((a) => a.kind)).toEqual(['duplicate']);
  });

  it('alur tanpa isian uang (cuti: jumlah hari bukan nominal) hanya dicek untuk pengajuan ganda', () => {
    const leave: FlowDefinition = JSON.parse(readFileSync(new URL('../examples/leave.json', import.meta.url), 'utf8'));
    const data = { leave_type: 'tahunan', start_date: '2026-12-01', end_date: '2026-12-02', days: 2 };
    const out = detectAnomalies({
      definition: leave,
      current: { id: 'REQ-L', requesterId: 'u_budi', data, createdAt: NOW },
      history: [{ id: 'REQ-L0', requesterId: 'u_budi', data, createdAt: daysAgo(1), status: 'in_progress' }],
    });
    expect(out.map((a) => a.kind)).toEqual(['duplicate']);
    expect(amountField(leave)).toBeUndefined();
  });
});
