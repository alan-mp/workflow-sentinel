import { useEffect, useRef, useState } from 'react';
import { BUILTIN_FIELDS, UNIT_LEVELS, UNIT_LEVEL_LABEL, type Condition, type FlowDefinition, type Step } from '@sentinel/engine/model';
import { api } from '../api';
import { DynamicForm } from '../pages';
import { X } from 'lucide-react';
import { conditionParts, roleLabel, uniqueId } from './edit';
import { blocks, sopTitle, type Inline } from '../markdown';

type AnyApprover = { kind: string; level?: number | string; role?: string; userId?: string; tableId?: string };

export function ApproverEditor(props: {
  value: AnyApprover;
  onChange: (v: any) => void;
  def: FlowDefinition;
  roles: string[];
  extra?: ('table' | 'requester' | 'none')[];
  disabled?: boolean;
}) {
  const { value, onChange, def, roles, extra = [] } = props;
  const pick = (kind: string) => {
    if (kind === 'manager') onChange({ kind, level: 1 });
    else if (kind === 'unit_head') onChange({ kind, level: 'departemen' });
    else if (kind === 'role') onChange({ kind, role: roles[0] ?? '' });
    else if (kind === 'user') onChange({ kind, userId: '' });
    else if (kind === 'table') onChange({ kind, tableId: def.tables[0]?.id ?? '' });
    else onChange({ kind });
  };
  return (
    <div className="inline">
      <select value={value.kind} onChange={(e) => pick(e.target.value)} disabled={props.disabled}>
        <optgroup label="By structure">
          <option value="manager">Requester's superior</option>
          <option value="unit_head">Requester's unit head</option>
        </optgroup>
        <optgroup label="By authority">
          <option value="role">Authority holder</option>
        </optgroup>
        <option value="user">Specific user</option>
        {extra.includes('table') ? <option value="table">Rule table</option> : null}
        {extra.includes('requester') ? <option value="requester">Requester</option> : null}
        {extra.includes('none') ? <option value="none">No approval required</option> : null}
      </select>
      {value.kind === 'manager' ? (
        <select value={value.level} onChange={(e) => onChange({ kind: 'manager', level: Number(e.target.value) })} disabled={props.disabled}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? 'direct superior' : `${n} levels up`}
            </option>
          ))}
        </select>
      ) : null}
      {value.kind === 'unit_head' ? (
        <select value={value.level} onChange={(e) => onChange({ kind: 'unit_head', level: e.target.value })} disabled={props.disabled}>
          {UNIT_LEVELS.map((l) => (
            <option key={l} value={l}>
              {UNIT_LEVEL_LABEL[l].toLowerCase()} level
            </option>
          ))}
        </select>
      ) : null}
      {value.kind === 'role' ? (
        <select value={value.role} onChange={(e) => onChange({ kind: 'role', role: e.target.value })} disabled={props.disabled}>
          {[...new Set([...(value.role ? [value.role] : []), ...roles])].map((r) => (
            <option key={r} value={r}>
              {roleLabel(r)}
            </option>
          ))}
        </select>
      ) : null}
      {value.kind === 'user' ? (
        <input placeholder="User ID" value={value.userId} onChange={(e) => onChange({ kind: 'user', userId: e.target.value })} disabled={props.disabled} />
      ) : null}
      {value.kind === 'table' ? (
        <select value={value.tableId} onChange={(e) => onChange({ kind: 'table', tableId: e.target.value })} disabled={props.disabled}>
          {def.tables.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

export function ConditionsEditor(props: { value: Condition[]; onChange: (v: Condition[]) => void; def: FlowDefinition; disabled?: boolean }) {
  const { value, onChange, def } = props;
  const types: Record<string, string> = { ...BUILTIN_FIELDS, ...Object.fromEntries(def.fields.map((f) => [f.key, f.type])) };
  const set = (i: number, patch: Partial<Condition>) => onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const parse = (c: Condition, raw: string): Condition['value'] => {
    const one = (s: string) => (types[c.field] === 'number' ? Number(s) : types[c.field] === 'boolean' ? s === 'true' : s);
    return c.op === 'in' ? raw.split(',').map((s) => one(s.trim())) : one(raw);
  };
  return (
    <div className="conditions">
      {value.map((c, i) => (
        <div key={i} className="inline">
          <select value={c.field} onChange={(e) => set(i, { field: e.target.value, value: '' })} disabled={props.disabled}>
            <option value="requester.department">Requester department</option>
            {def.fields.map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            value={c.op}
            onChange={(e) => {
              const op = e.target.value as Condition['op'];
              const flat = Array.isArray(c.value) ? (c.value[0] ?? '') : c.value;
              set(i, { op, value: op === 'in' ? [flat] : flat });
            }}
            disabled={props.disabled}
          >
            <option value="eq">=</option>
            <option value="neq">≠</option>
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
            <option value="in">one of</option>
          </select>
          <input
            className="grow"
            type={types[c.field] === 'number' && c.op !== 'in' ? 'number' : types[c.field] === 'date' ? 'date' : 'text'}
            placeholder={c.op === 'in' ? 'a, b, c' : 'value'}
            value={Array.isArray(c.value) ? c.value.join(', ') : String(c.value)}
            onChange={(e) => set(i, { value: parse(c, e.target.value) })}
            disabled={props.disabled}
          />
          {props.disabled ? null : (
            <button className="icon-btn" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove condition" title="Remove condition">
              <X size={16} />
            </button>
          )}
        </div>
      ))}
      {props.disabled ? null : (
        <button className="link" onClick={() => onChange([...value, { field: def.fields[0]?.key ?? 'requester.department', op: 'eq', value: '' }])}>
          + condition
        </button>
      )}
    </div>
  );
}

export function Quotes({ citations, target }: { citations: any[]; target: string }) {
  const list = citations.filter((q) => q.target === target);
  if (list.length === 0) return null;
  return (
    <div className="quotes">
      {list.map((q, i) => (
        <blockquote key={i} className={q.source === 'sop' && !q.verified ? 'unverified' : ''}>
          “{q.quote}”
          <footer>
            {q.source === 'admin' ? 'from the administrator\'s explanation' : q.verified ? `SOP${q.section ? `, ${q.section}` : ''}` : 'this quote was not found in the SOP text; check it manually'}
          </footer>
        </blockquote>
      ))}
    </div>
  );
}

export function StepPanel(props: {
  step: Step;
  def: FlowDefinition;
  roles: string[];
  citations: any[];
  readOnly: boolean;
  onChange: (s: Step) => void;
  onDelete: () => void;
}) {
  const { step, def, onChange, readOnly } = props;
  const patch = (p: object) => onChange({ ...step, ...p } as Step);
  return (
    <div className="panel">
      <label>
        <span>Step name</span>
        <input value={step.name} onChange={(e) => patch({ name: e.target.value })} disabled={readOnly} />
      </label>
      {step.type === 'approval' ? (
        <>
          <label>
            <span>Approved by</span>
          </label>
          <ApproverEditor value={step.approver} onChange={(approver) => patch({ approver })} def={def} roles={props.roles} extra={['table']} disabled={readOnly} />
          <label>
            <span>SLA (hours)</span>
            <input type="number" min="1" value={step.slaHours ?? ''} disabled={readOnly} onChange={(e) => patch({ slaHours: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
          <p className="muted small">Past the SLA: a reminder is sent. Past twice the SLA: escalated to the approver's superior.</p>
        </>
      ) : null}
      {step.type === 'notify' ? (
        <>
          <label>
            <span>Send to</span>
          </label>
          <ApproverEditor value={step.to} onChange={(to) => patch({ to })} def={def} roles={props.roles} extra={['requester']} disabled={readOnly} />
          <label>
            <span>Message</span>
            <textarea value={step.message} onChange={(e) => patch({ message: e.target.value })} disabled={readOnly} />
          </label>
        </>
      ) : null}
      {step.type === 'condition' ? (
        <>
          {step.branches.map((b, i) => (
            <fieldset key={i}>
              <legend>Branch {i + 1}</legend>
              <ConditionsEditor
                value={b.when}
                def={def}
                disabled={readOnly}
                onChange={(when) => patch({ branches: step.branches.map((x, j) => (j === i ? { ...x, when } : x)) })}
              />
              {!readOnly && step.branches.length > 1 ? (
                <button className="link danger" onClick={() => patch({ branches: step.branches.filter((_, j) => j !== i) })}>
                  Remove branch
                </button>
              ) : null}
            </fieldset>
          ))}
          {readOnly ? null : (
            <button
              className="link"
              onClick={() => patch({ branches: [...step.branches, { when: [{ field: def.fields[0]?.key ?? 'requester.department', op: 'eq', value: '' }], steps: [] }] })}
            >
              + branch
            </button>
          )}
          <p className="muted small">The first matching branch runs. If none match, the "otherwise" path is used.</p>
        </>
      ) : null}
      {step.type === 'parallel' ? (
        <>
          <p className="muted small">{step.branches.length} branches run at the same time. All must finish before the flow continues.</p>
          {readOnly ? null : (
            <div className="inline">
              <button className="link" onClick={() => patch({ branches: [...step.branches, []] })}>
                + branch
              </button>
              {step.branches.length > 2 ? (
                <button className="link danger" onClick={() => patch({ branches: step.branches.slice(0, -1) })}>
                  Remove last branch
                </button>
              ) : null}
            </div>
          )}
        </>
      ) : null}
      <Quotes citations={props.citations} target={step.id} />
      {readOnly ? null : (
        <button className="danger" onClick={props.onDelete}>
          Delete step
        </button>
      )}
    </div>
  );
}

export function TablesPanel(props: { def: FlowDefinition; roles: string[]; citations: any[]; readOnly: boolean; onChange: (d: FlowDefinition) => void }) {
  const { def, onChange, readOnly } = props;
  const setTable = (i: number, patch: object) => onChange({ ...def, tables: def.tables.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <div className="panel">
      {def.tables.length === 0 ? <p className="muted">No rule tables yet.</p> : null}
      {def.tables.map((table, ti) => {
        const setRows = (rows: typeof table.rows) => setTable(ti, { rows });
        const move = (i: number, d: number) => {
          const rows = [...table.rows];
          [rows[i], rows[i + d]] = [rows[i + d]!, rows[i]!];
          setRows(rows);
        };
        return (
          <fieldset key={table.id}>
            <legend>
              <input value={table.name} onChange={(e) => setTable(ti, { name: e.target.value })} disabled={readOnly} />
            </legend>
            <p className="muted small">The first matching row is used. The last row must have no conditions (default).</p>
            {table.rows.map((row, ri) => (
              <div key={row.id} className="rule-row">
                <div className="rule-when">
                  <span className="rule-n num">{ri + 1}</span>
                  {row.when.length ? (
                    <span className="limits">
                      If
                      {conditionParts(def, row.when).map((part, k) => (
                        <span key={k} className="limit">
                          {k > 0 ? <span className="limit-and">and</span> : null}
                          {part.label}
                          <span className="limit-value num">
                            <span className="limit-op">{part.op}</span> {part.value}
                          </span>
                        </span>
                      ))}
                    </span>
                  ) : (
                    'Otherwise (default)'
                  )}
                </div>
                <ConditionsEditor value={row.when} def={def} disabled={readOnly} onChange={(when) => setRows(table.rows.map((r, j) => (j === ri ? { ...r, when } : r)))} />
                <ApproverEditor
                  value={row.approver}
                  def={def}
                  roles={props.roles}
                  extra={['none']}
                  disabled={readOnly}
                  onChange={(approver) => setRows(table.rows.map((r, j) => (j === ri ? { ...r, approver } : r)))}
                />
                <Quotes citations={props.citations} target={`${table.id}.${row.id}`} />
                {readOnly ? null : (
                  <div className="inline">
                    <button className="link" disabled={ri === 0} onClick={() => move(ri, -1)}>
                      ↑
                    </button>
                    <button className="link" disabled={ri === table.rows.length - 1} onClick={() => move(ri, 1)}>
                      ↓
                    </button>
                    <button className="link danger" disabled={table.rows.length === 1} onClick={() => setRows(table.rows.filter((_, j) => j !== ri))}>
                      Remove row
                    </button>
                  </div>
                )}
              </div>
            ))}
            {readOnly ? null : (
              <div className="inline">
                <button
                  className="link"
                  onClick={() => {
                    let n = table.rows.length + 1;
                    while (table.rows.some((r) => r.id === `baris_${n}`)) n++;
                    const fresh = { id: `baris_${n}`, when: [{ field: def.fields[0]?.key ?? 'requester.department', op: 'eq' as const, value: '' }], approver: { kind: 'manager' as const, level: 1 } };
                    setRows([...table.rows.slice(0, -1), fresh, table.rows[table.rows.length - 1]!]);
                  }}
                >
                  + row
                </button>
                <button className="link danger" onClick={() => onChange({ ...def, tables: def.tables.filter((_, j) => j !== ti) })}>
                  Delete table
                </button>
              </div>
            )}
          </fieldset>
        );
      })}
      {readOnly ? null : (
        <button
          onClick={() =>
            onChange({
              ...def,
              tables: [...def.tables, { id: uniqueId(def, 'tabel'), name: 'New table', rows: [{ id: 'default', when: [], approver: { kind: 'manager', level: 1 } }] }],
            })
          }
        >
          + Rule table
        </button>
      )}
    </div>
  );
}

export function SimPanel({ def }: { def: FlowDefinition }) {
  const [users, setUsers] = useState<any[]>([]);
  const [requesterId, setRequester] = useState('');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('GET', '/admin/users').then(setUsers);
  }, []);
  const run = async () => {
    setError('');
    setResult(null);
    try {
      setResult(await api('POST', '/admin/simulate', { definition: def, requesterId, data }));
    } catch (e: any) {
      setError(e.body?.issues?.find((i: any) => i.level === 'error')?.message ?? e.message);
    }
  };
  return (
    <div className="panel">
      <p className="muted small">Uses the diagram and tables as shown, including unsaved changes.</p>
      <label>
        <span>Requester</span>
        <select value={requesterId} onChange={(e) => setRequester(e.target.value)}>
          <option value="">Select</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.department})
            </option>
          ))}
        </select>
      </label>
      <DynamicForm fields={def.fields} value={data} onChange={setData} />
      <button className="primary" disabled={!requesterId} onClick={run}>
        Run simulation
      </button>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <ol className="sim">
          {result.steps.map((s: any) => (
            <li key={s.stepId} className={s.error ? 'bad' : s.skipped ? 'skipped' : 'ok'}>
              <strong>{s.name}</strong>
              {s.type === 'notify' ? ' (notification)' : ''}:{' '}
              {s.error ?? (s.skipped ? 'not required' : s.userIds.map((id: string) => result.names[id] ?? id).join(' or '))}
              <div className="muted small">
                {[
                  s.parallelIn ? 'parallel' : '',
                  s.tableRow ? `table ${s.tableRow.tableId}, row ${s.tableRow.rowId}` : '',
                  s.reroutedToManager ? 'rerouted to the superior because the requester is the approver' : s.requesterExcluded ? 'requester removed from the approver list' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function Rich({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((p, i) => (p.kind === 'bold' ? <strong key={i}>{p.text}</strong> : p.kind === 'code' ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>))}
    </>
  );
}

/** Assistant replies are light Markdown; user messages are shown exactly as typed. */
function Message({ role, content }: { role: string; content: string }) {
  if (role !== 'assistant') return <div className={`msg ${role}`}>{content}</div>;
  return (
    <div className="msg assistant md">
      {blocks(content).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <span key={j}>
                {j > 0 ? <br /> : null}
                <Rich parts={l} />
              </span>
            ))}
          </p>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Rich parts={it} />
              </li>
            ))}
          </ul>
        ) : (
          <ol key={i} start={b.start}>
            {b.items.map((it, j) => (
              <li key={j}>
                <Rich parts={it} />
              </li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

export function ChatPanel(props: { draftId: string; chat: any[]; sop: any; readOnly: boolean; beforeSend: () => Promise<void>; onDone: () => void }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sopText, setSopText] = useState('');
  const [sopName, setSopName] = useState('');
  const [showSop, setShowSop] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [props.chat.length, busy]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await props.beforeSend();
      await fn();
      props.onDone();
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };
  const send = () =>
    run(async () => {
      await api('POST', `/admin/drafts/${props.draftId}/chat`, { message });
      setMessage('');
    });
  const saveSop = () =>
    run(async () => {
      await api('POST', `/admin/drafts/${props.draftId}/sop`, { name: sopName || sopTitle(sopText), content: sopText });
      setShowSop(false);
    });
  const readFile = async (file?: File) => {
    if (!file) return;
    setSopName(file.name);
    setSopText(await file.text());
  };

  return (
    <div className="panel chat">
      <div className="sop-bar">
        {props.sop ? (
          <span>
            SOP: <a href={`/api/admin/sop/${props.sop.id}`} target="_blank" rel="noreferrer">{props.sop.name}</a>
          </span>
        ) : (
          <span className="muted">No SOP yet</span>
        )}
        {props.readOnly ? null : (
          <button className="link" onClick={() => setShowSop(!showSop)}>
            {props.sop ? 'Replace' : 'Upload SOP'}
          </button>
        )}
      </div>
      {showSop ? (
        <div className="sop-form">
          <input type="file" accept=".txt,.md,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
          <textarea placeholder="or paste the SOP text here" value={sopText} onChange={(e) => setSopText(e.target.value)} rows={6} />
          <button className="primary" disabled={busy || !sopText.trim()} onClick={saveSop}>
            Save SOP
          </button>
        </div>
      ) : null}
      <div className="messages">
        {props.chat.length === 0 ? (
          <p className="muted small">Upload the SOP and ask the AI to draft the flow, or describe the rules. The AI only changes this draft; activating it is a separate step.</p>
        ) : null}
        {props.chat.map((m, i) => (
          <Message key={i} role={m.role} content={m.content} />
        ))}
        {busy ? <div className="msg assistant muted">Drafting…</div> : null}
        <div ref={end} />
      </div>
      {error ? <p className="error">{error}</p> : null}
      {props.readOnly ? null : (
        <div className="composer">
          <textarea placeholder="Example: draft the flow from this SOP" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          <button className="primary" disabled={busy || !message.trim()} onClick={send}>
            Send
          </button>
        </div>
      )}
    </div>
  );
}
