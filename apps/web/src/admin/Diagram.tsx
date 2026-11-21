import { createContext, useContext, useMemo, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowDefinition, Step } from '@sentinel/engine';
import { approverText, type SeqRef } from './edit';
import { layout, type SlotData } from './layout';

interface Ctx {
  def: FlowDefinition;
  selected: string | null;
  readOnly: boolean;
  issues: Set<string>;
  onSelect: (id: string) => void;
  onAdd: (seq: SeqRef, index: number, type: Step['type']) => void;
}
const DiagramCtx = createContext<Ctx>(null as never);

const Handles = () => (
  <>
    <Handle type="target" position={Position.Top} isConnectable={false} />
    <Handle type="source" position={Position.Bottom} isConnectable={false} />
  </>
);

const KIND: Record<Step['type'], string> = { approval: 'Approval', condition: 'Kondisi', parallel: 'Paralel', notify: 'Notifikasi' };

function StepNode({ data }: NodeProps) {
  const ctx = useContext(DiagramCtx);
  const step = (data as { step: Step }).step;
  const sub =
    step.type === 'approval'
      ? approverText(step.approver, ctx.def)
      : step.type === 'notify'
        ? `ke ${approverText(step.to, ctx.def)}`
        : step.type === 'parallel'
          ? 'semua cabang harus setuju'
          : 'cabang pertama yang cocok';
  return (
    <div className={`node ${step.type} ${ctx.selected === step.id ? 'selected' : ''}`} onClick={() => ctx.onSelect(step.id)}>
      <Handles />
      <div className="kind">{KIND[step.type]}</div>
      <div className="title">{step.name}</div>
      <div className="sub">{sub}</div>
    </div>
  );
}

function SlotNode({ data }: NodeProps) {
  const ctx = useContext(DiagramCtx);
  const slot = data as SlotData;
  const [open, setOpen] = useState(false);
  return (
    <div className="slot">
      <Handles />
      {slot.label ? <div className="branch-label">{slot.label}</div> : null}
      {ctx.readOnly ? (
        <div className="dot" />
      ) : (
        <button className="add" title="Tambah langkah di sini" onClick={() => setOpen(!open)}>
          +
        </button>
      )}
      {open ? (
        <div className="add-menu nodrag nopan">
          {(Object.keys(KIND) as Step['type'][]).map((type) => (
            <button
              key={type}
              onClick={() => {
                setOpen(false);
                ctx.onAdd(slot.seq, slot.index, type);
              }}
            >
              {KIND[type]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const JoinNode = () => (
  <div className="slot">
    <Handles />
    <div className="dot" />
  </div>
);

const TerminalNode = ({ data }: NodeProps) => (
  <div className="terminal">
    <Handles />
    {(data as { label: string }).label}
  </div>
);

const nodeTypes = { step: StepNode, slot: SlotNode, join: JoinNode, terminal: TerminalNode };

export function Diagram(props: Ctx) {
  const { nodes, edges } = useMemo(() => layout(props.def), [props.def]);
  return (
    <DiagramCtx.Provider value={props}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        fitView
        fitViewOptions={{ maxZoom: 1, padding: 0.1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </DiagramCtx.Provider>
  );
}
