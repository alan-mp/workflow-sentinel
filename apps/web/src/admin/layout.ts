import type { Edge, Node } from '@xyflow/react';
import type { FlowDefinition, Step } from '@sentinel/engine/model';
import { conditionText, seqKey, type SeqRef } from './edit';

const W = 224;
const H = 72;
const SLOT = 26;
const GAP_Y = 18;
const GAP_X = 28;

export type SlotData = { seq: SeqRef; index: number; label?: string };

const widthOfStep = (s: Step): number => {
  const branches = s.type === 'condition' ? [...s.branches.map((b) => b.steps), s.otherwise] : s.type === 'parallel' ? s.branches : null;
  if (!branches) return W;
  return Math.max(W, branches.reduce((sum, b) => sum + widthOfSeq(b), 0) + GAP_X * (branches.length - 1));
};
const widthOfSeq = (steps: Step[]): number => Math.max(W, ...steps.map(widthOfStep));

/** Menghitung posisi diagram dari struktur alur; tidak ada posisi yang disimpan. */
export function layout(def: FlowDefinition): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const edge = (source: string, target: string) => edges.push({ id: `${source}>${target}`, source, target, type: 'smoothstep' });

  const placeSeq = (steps: Step[], seq: SeqRef, cx: number, y: number, label?: string) => {
    let prev: string | null = null;
    let first = '';
    const slot = (index: number) => {
      const id = `slot:${seqKey(seq)}:${index}`;
      const hasLabel = index === 0 && label;
      nodes.push({
        id,
        type: 'slot',
        position: { x: cx - W / 2, y },
        data: { seq, index, label: hasLabel ? label : undefined } satisfies SlotData,
        style: { width: W },
      });
      y += (hasLabel ? SLOT + 22 : SLOT) + GAP_Y;
      if (prev) edge(prev, id);
      else first = id;
      prev = id;
    };
    slot(0);
    steps.forEach((step, i) => {
      const placed = placeStep(step, cx, y);
      edge(prev!, placed.entry);
      prev = placed.exit;
      y = placed.bottom + GAP_Y;
      slot(i + 1);
    });
    return { first, last: prev!, bottom: y - GAP_Y };
  };

  const placeStep = (step: Step, cx: number, y: number): { entry: string; exit: string; bottom: number } => {
    nodes.push({ id: step.id, type: 'step', position: { x: cx - W / 2, y }, data: { step }, style: { width: W } });
    if (step.type === 'approval' || step.type === 'notify') return { entry: step.id, exit: step.id, bottom: y + H };

    const branches =
      step.type === 'condition'
        ? [
            ...step.branches.map((b, i) => ({ steps: b.steps, branch: i as number | 'otherwise', label: conditionText(def, b.when) })),
            { steps: step.otherwise, branch: 'otherwise' as const, label: 'otherwise' },
          ]
        : step.branches.map((b, i) => ({ steps: b, branch: i as number | 'otherwise', label: undefined }));
    const widths = branches.map((b) => widthOfSeq(b.steps));
    let x = cx - (widths.reduce((a, b) => a + b, 0) + GAP_X * (branches.length - 1)) / 2;
    let bottom = y;
    const lasts: string[] = [];
    branches.forEach((b, i) => {
      const placed = placeSeq(b.steps, { parent: step.id, branch: b.branch }, x + widths[i]! / 2, y + H + GAP_Y, b.label);
      edge(step.id, placed.first);
      lasts.push(placed.last);
      bottom = Math.max(bottom, placed.bottom);
      x += widths[i]! + GAP_X;
    });
    const join = `join:${step.id}`;
    nodes.push({ id: join, type: 'join', position: { x: cx - W / 2, y: bottom + GAP_Y }, data: {}, style: { width: W } });
    lasts.forEach((l) => edge(l, join));
    return { entry: step.id, exit: join, bottom: bottom + GAP_Y + 10 };
  };

  nodes.push({ id: 'start', type: 'terminal', position: { x: -W / 2, y: 0 }, data: { label: 'Request submitted' }, style: { width: W } });
  const root = placeSeq(def.steps, { parent: null, branch: 0 }, 0, 34 + GAP_Y);
  edge('start', root.first);
  nodes.push({ id: 'end', type: 'terminal', position: { x: -W / 2, y: root.bottom + GAP_Y }, data: { label: 'Approved' }, style: { width: W } });
  edge(root.last, 'end');
  return { nodes, edges };
}
