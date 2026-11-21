import { useEffect, useRef, useState } from 'react';
import { BUILTIN_FIELDS, type Condition, type FlowDefinition, type Step } from '@sentinel/engine';
import { api } from '../api';
import { DynamicForm } from '../pages';
import { conditionText, uniqueId } from './edit';

type AnyApprover = { kind: string; level?: number; role?: string; userId?: string; tableId?: string };

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
    else if (kind === 'role') onChange({ kind, role: roles[0] ?? '' });
    else if (kind === 'user') onChange({ kind, userId: '' });
    else if (kind === 'table') onChange({ kind, tableId: def.tables[0]?.id ?? '' });
    else onChange({ kind });
  };
  return (
    <div className="inline">
      <select value={value.kind} onChange={(e) => pick(e.target.value)} disabled={props.disabled}>
        <option value="manager">Atasan pemohon</option>
        <option value="role">Peran</option>
        <option value="user">User tertentu</option>
        {extra.includes('table') ? <option value="table">Tabel aturan</option> : null}
        {extra.includes('requester') ? <option value="requester">Pemohon</option> : null}
        {extra.includes('none') ? <option value="none">Tidak perlu approval</option> : null}
      </select>
      {value.kind === 'manager' ? (
        <select value={value.level} onChange={(e) => onChange({ kind: 'manager', level: Number(e.target.value) })} disabled={props.disabled}>
          {[1, 2, 3, 4, 5].map((n) => (
            <option key={n} value={n}>
              tingkat {n}
            </option>
          ))}
        </select>
      ) : null}
      {value.kind === 'role' ? (
        <>
          <input list="roles" value={value.role} onChange={(e) => onChange({ kind: 'role', role: e.target.value })} disabled={props.disabled} />
          <datalist id="roles">
            {roles.map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
        </>
      ) : null}
      {value.kind === 'user' ? (
        <input placeholder="ID user" value={value.userId} onChange={(e) => onChange({ kind: 'user', userId: e.target.value })} disabled={props.disabled} />
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
            <option value="requester.department">Departemen pemohon</option>
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
            <option value="in">salah satu dari</option>
          </select>
          <input
            className="grow"
            type={types[c.field] === 'number' && c.op !== 'in' ? 'number' : types[c.field] === 'date' ? 'date' : 'text'}
            placeholder={c.op === 'in' ? 'a, b, c' : 'nilai'}
            value={Array.isArray(c.value) ? c.value.join(', ') : String(c.value)}
            onChange={(e) => set(i, { value: parse(c, e.target.value) })}
            disabled={props.disabled}
          />
          {props.disabled ? null : (
            <button className="link" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              ×
            </button>
          )}
        </div>
      ))}
      {props.disabled ? null : (
        <button className="link" onClick={() => onChange([...value, { field: def.fields[0]?.key ?? 'requester.department', op: 'eq', value: '' }])}>
          + kondisi
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
            {q.source === 'admin' ? 'dari penjelasan admin' : q.verified ? `SOP${q.section ? `, ${q.section}` : ''}` : 'kutipan ini tidak ditemukan di teks SOP, periksa manual'}
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
        <span>Nama langkah</span>
        <input value={step.name} onChange={(e) => patch({ name: e.target.value })} disabled={readOnly} />
      </label>
      {step.type === 'approval' ? (
        <>
          <label>
            <span>Disetujui oleh</span>
          </label>
          <ApproverEditor value={step.approver} onChange={(approver) => patch({ approver })} def={def} roles={props.roles} extra={['table']} disabled={readOnly} />
          <label>
            <span>SLA (jam)</span>
            <input type="number" min="1" value={step.slaHours ?? ''} disabled={readOnly} onChange={(e) => patch({ slaHours: e.target.value ? Number(e.target.value) : undefined })} />
          </label>
          <p className="muted small">Lewat SLA: pengingat. Lewat dua kali SLA: eskalasi ke atasan approver.</p>
        </>
      ) : null}
      {step.type === 'notify' ? (
        <>
          <label>
            <span>Dikirim ke</span>
          </label>
          <ApproverEditor value={step.to} onChange={(to) => patch({ to })} def={def} roles={props.roles} extra={['requester']} disabled={readOnly} />
          <label>
            <span>Pesan</span>
            <textarea value={step.message} onChange={(e) => patch({ message: e.target.value })} disabled={readOnly} />
          </label>
        </>
      ) : null}
      {step.type === 'condition' ? (
        <>
          {step.branches.map((b, i) => (
            <fieldset key={i}>
              <legend>Cabang {i + 1}</legend>
              <ConditionsEditor
                value={b.when}
                def={def}
                disabled={readOnly}
                onChange={(when) => patch({ branches: step.branches.map((x, j) => (j === i ? { ...x, when } : x)) })}
              />
              {!readOnly && step.branches.length > 1 ? (
                <button className="link danger" onClick={() => patch({ branches: step.branches.filter((_, j) => j !== i) })}>
                  Hapus cabang
                </button>
              ) : null}
            </fieldset>
          ))}
          {readOnly ? null : (
            <button
              className="link"
              onClick={() => patch({ branches: [...step.branches, { when: [{ field: def.fields[0]?.key ?? 'requester.department', op: 'eq', value: '' }], steps: [] }] })}
            >
              + cabang
            </button>
          )}
          <p className="muted small">Cabang pertama yang cocok dijalankan. Kalau tidak ada yang cocok, jalur "selain itu" dipakai.</p>
        </>
      ) : null}
      {step.type === 'parallel' ? (
        <>
          <p className="muted small">{step.branches.length} cabang berjalan bersamaan. Semua harus selesai sebelum lanjut.</p>
          {readOnly ? null : (
            <div className="inline">
              <button className="link" onClick={() => patch({ branches: [...step.branches, []] })}>
                + cabang
              </button>
              {step.branches.length > 2 ? (
                <button className="link danger" onClick={() => patch({ branches: step.branches.slice(0, -1) })}>
                  Hapus cabang terakhir
                </button>
              ) : null}
            </div>
          )}
        </>
      ) : null}
      <Quotes citations={props.citations} target={step.id} />
      {readOnly ? null : (
        <button className="danger" onClick={props.onDelete}>
          Hapus langkah
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
      {def.tables.length === 0 ? <p className="muted">Belum ada tabel aturan.</p> : null}
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
            <p className="muted small">Baris pertama yang cocok dipakai. Baris terakhir harus tanpa kondisi (default).</p>
            {table.rows.map((row, ri) => (
              <div key={row.id} className="rule-row">
                <div className="muted small">
                  {ri + 1}. Jika {conditionText(def, row.when)}
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
                      Hapus baris
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
                  + baris
                </button>
                <button className="link danger" onClick={() => onChange({ ...def, tables: def.tables.filter((_, j) => j !== ti) })}>
                  Hapus tabel
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
              tables: [...def.tables, { id: uniqueId(def, 'tabel'), name: 'Tabel baru', rows: [{ id: 'default', when: [], approver: { kind: 'manager', level: 1 } }] }],
            })
          }
        >
          + Tabel aturan
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
      <p className="muted small">Memakai diagram dan tabel yang sedang tampil, termasuk perubahan yang belum disimpan.</p>
      <label>
        <span>Pemohon</span>
        <select value={requesterId} onChange={(e) => setRequester(e.target.value)}>
          <option value="">Pilih</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.department})
            </option>
          ))}
        </select>
      </label>
      <DynamicForm fields={def.fields} value={data} onChange={setData} />
      <button className="primary" disabled={!requesterId} onClick={run}>
        Simulasikan
      </button>
      {error ? <p className="error">{error}</p> : null}
      {result ? (
        <ol className="sim">
          {result.steps.map((s: any) => (
            <li key={s.stepId} className={s.error ? 'error' : s.skipped ? 'muted' : ''}>
              <strong>{s.name}</strong>
              {s.type === 'notify' ? ' (notifikasi)' : ''}:{' '}
              {s.error ?? (s.skipped ? 'tidak diperlukan' : s.userIds.map((id: string) => result.names[id] ?? id).join(' atau '))}
              <div className="muted small">
                {[
                  s.parallelIn ? 'paralel' : '',
                  s.tableRow ? `tabel ${s.tableRow.tableId}, baris ${s.tableRow.rowId}` : '',
                  s.reroutedToManager ? 'dialihkan ke atasan karena pemohon adalah approver' : s.requesterExcluded ? 'pemohon dikeluarkan dari daftar approver' : '',
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
      await api('POST', `/admin/drafts/${props.draftId}/sop`, { name: sopName || 'SOP', content: sopText });
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
          <span className="muted">Belum ada SOP</span>
        )}
        {props.readOnly ? null : (
          <button className="link" onClick={() => setShowSop(!showSop)}>
            {props.sop ? 'Ganti' : 'Unggah SOP'}
          </button>
        )}
      </div>
      {showSop ? (
        <div className="sop-form">
          <input type="file" accept=".txt,.md,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
          <textarea placeholder="atau tempel teks SOP di sini" value={sopText} onChange={(e) => setSopText(e.target.value)} rows={6} />
          <button className="primary" disabled={busy || !sopText.trim()} onClick={saveSop}>
            Simpan SOP
          </button>
        </div>
      ) : null}
      <div className="messages">
        {props.chat.length === 0 ? (
          <p className="muted small">Unggah SOP lalu minta AI menyusun draf, atau jelaskan aturannya. AI hanya mengubah draf ini; pengaktifan tetap oleh orang kedua.</p>
        ) : null}
        {props.chat.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        {busy ? <div className="msg assistant muted">Menyusun...</div> : null}
        <div ref={end} />
      </div>
      {error ? <p className="error">{error}</p> : null}
      {props.readOnly ? null : (
        <div className="composer">
          <textarea placeholder="Contoh: susun alur dari SOP ini" value={message} onChange={(e) => setMessage(e.target.value)} rows={2} />
          <button className="primary" disabled={busy || !message.trim()} onClick={send}>
            Kirim
          </button>
        </div>
      )}
    </div>
  );
}
