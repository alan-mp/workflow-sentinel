import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, getNodesBounds, type NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { FlowDefinition, Step } from '@sentinel/engine/model';
import { Plus } from 'lucide-react';
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
      <div className="kind">
        <span className="kind-mark" aria-hidden="true" />
        {KIND[step.type]}
        {step.type === 'approval' && step.slaHours ? <span className="node-sla num">SLA {step.slaHours} j</span> : null}
      </div>
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
        <button className="add" title="Tambah langkah di sini" aria-label="Tambah langkah di sini" onClick={() => setOpen(!open)}>
          <Plus size={14} />
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
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <DiagramCtx.Provider value={props}>
      <div ref={wrap} style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        minZoom={0.2}
        panOnScroll
        onInit={(rf) => {
          // Alur panjang tidak dikecilkan sampai tak terbaca; pengguna menggulir atau memakai kontrol zoom.
          const el = wrap.current;
          if (!el || nodes.length === 0) return;
          const b = getNodesBounds(nodes);
          // Zoom bulat 1 menjaga teks tetap tajam; alur yang lebih tinggi dari kanvas dimulai dari atas.
          const zoom = 1;
          const x = el.clientWidth / 2 - (b.x + b.width / 2) * zoom;
          const y = b.height * 1.1 <= el.clientHeight ? el.clientHeight / 2 - (b.y + b.height / 2) * zoom : 24 - b.y * zoom;
          rf.setViewport({ x, y, zoom });
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
      </div>
    </DiagramCtx.Provider>
  );
}
