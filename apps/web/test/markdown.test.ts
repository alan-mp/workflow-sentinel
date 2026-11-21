import { describe, expect, it } from 'vitest';
import { blocks, inline, sopTitle } from '../src/markdown';

describe('balasan AI berformat Markdown', () => {
  it('mengubah tebal dan kode menjadi bagian terpisah, bukan HTML', () => {
    expect(inline('Ambang **Pasal 3** jadi `25jt_ke_atas` <b>x</b>')).toEqual([
      { kind: 'text', text: 'Ambang ' },
      { kind: 'bold', text: 'Pasal 3' },
      { kind: 'text', text: ' jadi ' },
      { kind: 'code', text: '25jt_ke_atas' },
      { kind: 'text', text: ' <b>x</b>' },
    ]);
  });

  it('mengelompokkan daftar dan paragraf', () => {
    const out = blocks('Sudah diperbarui:\n- **Keuangan:** 25 juta\n- Direktur: 50 juta\n\nMohon cek:\n1. SLA\n2. Kategori');
    expect(out.map((b) => b.kind)).toEqual(['p', 'ul', 'p', 'ol']);
    expect(out[1]).toMatchObject({ kind: 'ul', items: [[{ kind: 'bold', text: 'Keuangan:' }, { kind: 'text', text: ' 25 juta' }], [{ kind: 'text', text: 'Direktur: 50 juta' }]] });
  });

  it('daftar bernomor yang diselingi sub-butir tetap memakai nomor aslinya', () => {
    const out = blocks('1. Siapa?\n2. Ganti atau tambah?\n   - (a) baris baru\n   - (b) langkah baru\n3. Batas nominal?');
    expect(out.map((b) => (b.kind === 'ol' ? `ol@${b.start}` : b.kind))).toEqual(['ol@1', 'ul', 'ol@3']);
  });

  it('memberi nama SOP yang ditempel dari baris pertamanya', () => {
    expect(sopTitle('\n  SOP-PUR-01 Prosedur Permintaan Pembelian\nPasal 1')).toBe('SOP-PUR-01 Prosedur Permintaan Pembelian');
    expect(sopTitle('   ')).toBe('SOP');
  });
});

import { withUnchecked } from '../src/pages';

describe('kotak centang yang tidak disentuh', () => {
  it('dikirim sebagai false, bukan dihilangkan', () => {
    const fields = [
      { key: 'is_international', label: 'Luar negeri', type: 'boolean' as const },
      { key: 'cost', label: 'Biaya', type: 'number' as const },
    ];
    expect(withUnchecked(fields, { cost: 3_000_000 })).toEqual({ is_international: false, cost: 3_000_000 });
    expect(withUnchecked(fields, { is_international: true })).toEqual({ is_international: true });
  });
});
