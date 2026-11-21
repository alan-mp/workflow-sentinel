import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { flattenSteps, validateDefinition, type FlowDefinition } from '@sentinel/engine';
import { insertStep, newStep, removeStep, updateStep } from '../src/admin/edit';
import { layout } from '../src/admin/layout';

const def: FlowDefinition = JSON.parse(
  readFileSync(new URL('../../../packages/engine/examples/purchase.json', import.meta.url), 'utf8'),
);

describe('editor visual', () => {
  it('menyisipkan langkah di cabang kondisi tanpa mengubah definisi asal', () => {
    const step = newStep(def, 'approval');
    const next = insertStep(def, { parent: 'nominal_besar', branch: 'otherwise' }, 0, step);
    const cond = flattenSteps(next.steps).find((s) => s.id === 'nominal_besar') as any;
    expect(cond.otherwise.map((s: any) => s.id)).toEqual([step.id]);
    expect(flattenSteps(def.steps)).toHaveLength(7);
    expect(validateDefinition(next).ok).toBe(true);
  });

  it('mengubah dan menghapus langkah bersarang', () => {
    const keuangan = flattenSteps(def.steps).find((s) => s.id === 'keuangan')!;
    const renamed = updateStep(def, 'keuangan', { ...keuangan, name: 'Finance' });
    expect(flattenSteps(renamed.steps).find((s) => s.id === 'keuangan')!.name).toBe('Finance');
    expect(flattenSteps(removeStep(def, 'direktur').steps).some((s) => s.id === 'direktur')).toBe(false);
  });

  it('menghapus satu-satunya approval wajib langsung terdeteksi pemeriksaan', () => {
    const codes = validateDefinition(removeStep(def, 'atasan')).issues.map((i) => i.code);
    expect(codes).toContain('PATH_WITHOUT_APPROVAL');
  });

  it('blok baru punya ID unik dan hanya empat jenis', () => {
    const a = newStep(def, 'condition');
    const next = insertStep(def, { parent: null, branch: 0 }, 0, a);
    expect(newStep(next, 'condition').id).not.toBe(a.id);
  });

  it('diagram memuat semua langkah dan titik sisip', () => {
    const { nodes, edges } = layout(def);
    expect(nodes.filter((n) => n.type === 'step')).toHaveLength(7);
    expect(nodes.filter((n) => n.type === 'slot').length).toBeGreaterThan(7);
    const ids = new Set(nodes.map((n) => n.id));
    expect(edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
  });
});
