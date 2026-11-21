import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeft, Check, ChevronRight, Paperclip, RotateCcw, X } from 'lucide-react';
import type { Field } from '@sentinel/engine/model';
import { STATUS_LABEL, api, fmtDate, fmtDuration, fmtTime } from './api';
import type { Me } from './App';
import { Badge, Empty, ErrorNote, Loading, PageHead, Person, TOLERANCE_LABEL, ToleranceBar, splitName, tolerance, type ToleranceLevel } from './ui';

export { Badge } from './ui';

export function useLoad<T>(url: string, deps: unknown[] = []): [T | undefined, () => Promise<T | undefined>, string] {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const load = () =>
    api<T>('GET', url).then(
      (d) => {
        setData(d);
        setError('');
        return d;
      },
      (e) => {
        setError(e.message);
        return undefined;
      },
    );
  useEffect(() => {
    load();
  }, deps);
  return [data, load, error];
}

const fmtNumber = (v: unknown) => Number(v).toLocaleString('id-ID');

export function DynamicForm(props: { fields: Field[]; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; disabled?: boolean }) {
  const set = (key: string, v: unknown) => {
    const next = { ...props.value };
    if (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v))) delete next[key];
    else next[key] = v;
    props.onChange(next);
  };
  return (
    <div className="form-grid">
      {props.fields.map((f) =>
        f.type === 'boolean' ? (
          <label key={f.key} className="check">
            <input type="checkbox" checked={Boolean(props.value[f.key])} disabled={props.disabled} onChange={(e) => set(f.key, e.target.checked)} />
            <span>{f.label}</span>
          </label>
        ) : (
          <label key={f.key} className={`field ${f.type === 'string' && /alasan|keterangan|deskripsi/i.test(f.label) ? 'span-2' : ''}`}>
            <span className="field-label">
              {f.label}
              {f.optional ? <span className="optional"> opsional</span> : null}
            </span>
            <input
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              inputMode={f.type === 'number' ? 'decimal' : undefined}
              className={f.type === 'number' ? 'num' : undefined}
              value={(props.value[f.key] as string | number | undefined) ?? ''}
              required={!f.optional}
              disabled={props.disabled}
              onChange={(e) => set(f.key, f.type === 'number' ? e.target.valueAsNumber : e.target.value)}
            />
          </label>
        ),
      )}
    </div>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api('POST', '/login', { email, password });
      onDone();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <div className="login">
      <aside className="login-brand">
        <img src="/brand/mp-logo-white-768.png" alt="Mitra Prodin" width={168} height={79} />
        <div>
          <p className="login-app">Sentinel</p>
          <p className="login-tag">Approval cuti, akses IT, dan pembelian dalam satu alur yang tercatat.</p>
        </div>
      </aside>
      <form className="login-form" onSubmit={submit}>
        <h1>Masuk ke Sentinel</h1>
        <label className="field">
          <span className="field-label">Email kantor</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field">
          <span className="field-label">Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <ErrorNote>{error}</ErrorNote>
        <button className="btn primary block" disabled={busy}>
          {busy ? 'Memeriksa…' : 'Masuk'}
        </button>
      </form>
    </div>
  );
}

/* ---------- Kotak masuk ---------- */

type Task = {
  taskId: string;
  requestId: string;
  flowName: string;
  stepName: string;
  requesterName: string;
  dueAt: string | null;
  createdAt: string;
  onBehalfOf: string | null;
};

const LEVELS: ToleranceLevel[] = ['out', 'near', 'ok'];

export function Inbox(props: { selected?: string; query: string; setQuery: (q: string) => void; onChanged: () => void }) {
  const [tasks, reload, loadError] = useLoad<Task[]>('/inbox');
  const [flow, setFlow] = useState('');
  const [level, setLevel] = useState<ToleranceLevel | ''>('');
  const [sort, setSort] = useState<'due' | 'new' | 'requester'>('due');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkComment, setBulkComment] = useState('');
  const [bulk, setBulk] = useState<{ busy: boolean; done: number; errors: string[] } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const flows = useMemo(() => [...new Set((tasks ?? []).map((t) => t.flowName))].sort(), [tasks]);
  const levelOf = (t: Task) => tolerance(t.createdAt, t.dueAt).level;
  const counts = useMemo(() => {
    const c: Record<ToleranceLevel, number> = { out: 0, near: 0, ok: 0, none: 0 };
    for (const t of tasks ?? []) c[levelOf(t)]++;
    return c;
  }, [tasks]);

  const q = props.query.trim().toLowerCase();
  const rows = useMemo(() => {
    const list = (tasks ?? []).filter(
      (t) =>
        (!q || [t.requestId, t.requesterName, t.flowName, t.stepName].some((v) => v.toLowerCase().includes(q))) &&
        (!flow || t.flowName === flow) &&
        (!level || levelOf(t) === level),
    );
    const due = (t: Task) => (t.dueAt ? Date.parse(t.dueAt) : Infinity);
    if (sort === 'due') list.sort((x, y) => due(x) - due(y));
    if (sort === 'new') list.sort((x, y) => Date.parse(y.createdAt) - Date.parse(x.createdAt));
    if (sort === 'requester') list.sort((x, y) => x.requesterName.localeCompare(y.requesterName, 'id'));
    return list;
  }, [tasks, q, flow, level, sort]);

  const toggle = (id: string) => {
    const next = new Set(checked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChecked(next);
  };
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.taskId));
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.taskId)));

  const approveChecked = async () => {
    const picked = (tasks ?? []).filter((t) => checked.has(t.taskId));
    setConfirming(false);
    setBulk({ busy: true, done: 0, errors: [] });
    const errors: string[] = [];
    let done = 0;
    for (const t of picked) {
      try {
        await api('POST', `/requests/${t.requestId}/decision`, { taskId: t.taskId, type: 'approve', comment: bulkComment || undefined });
        done++;
      } catch (e: any) {
        errors.push(`${t.requestId}: ${e.message}`);
      }
      setBulk({ busy: true, done, errors: [...errors] });
    }
    setBulk({ busy: false, done, errors });
    setChecked(new Set());
    setBulkComment('');
    await reload();
    props.onChanged();
  };

  const afterDecision = async () => {
    const index = rows.findIndex((r) => r.requestId === props.selected);
    const fresh = await reload();
    props.onChanged();
    const remaining = rows.filter((r) => r.requestId !== props.selected && fresh?.some((f) => f.taskId === r.taskId));
    const next = remaining[Math.min(Math.max(index, 0), remaining.length - 1)];
    location.hash = next ? `#/inbox/${next.requestId}` : '#/inbox';
  };

  const filtersActive = Boolean(q || flow || level);
  return (
    <div className={`split ${props.selected ? 'has-detail' : ''}`}>
      <section className="split-list" aria-label="Daftar tugas">
        <PageHead
          title="Kotak masuk"
          sub={tasks ? `${tasks.length} tugas menunggu keputusan Anda` : undefined}
        />
        <div className="gauge" role="group" aria-label="Saring berdasarkan tenggat">
          <button className={`gauge-seg all ${level === '' ? 'on' : ''}`} onClick={() => setLevel('')}>
            <span className="gauge-n">{tasks?.length ?? 0}</span> Semua
          </button>
          {LEVELS.map((l) => (
            <button key={l} className={`gauge-seg ${l} ${level === l ? 'on' : ''}`} onClick={() => setLevel(level === l ? '' : l)} aria-pressed={level === l}>
              <span className="gauge-n">{counts[l]}</span> {TOLERANCE_LABEL[l]}
            </button>
          ))}
        </div>
        {checked.size > 0 ? (
          <div className="toolbar selection" role="region" aria-label="Aksi untuk tugas terpilih">
            <strong>{checked.size} dipilih</strong>
            <input className="grow" placeholder="Komentar untuk semua (opsional)" value={bulkComment} onChange={(e) => setBulkComment(e.target.value)} />
            {confirming ? (
              <>
                <span className="confirm-text">Setujui {checked.size} permintaan?</span>
                <button key="cancel" className="btn" onClick={() => setConfirming(false)}>
                  Batal
                </button>
                <button key="confirm" className="btn primary" onClick={approveChecked}>
                  <Check size={16} /> Ya, setujui {checked.size}
                </button>
              </>
            ) : (
              <>
                <button key="clear" className="btn ghost" onClick={() => setChecked(new Set())}>
                  Batal pilih
                </button>
                <button key="ask" className="btn primary" onClick={() => setConfirming(true)}>
                  <Check size={16} /> Setujui terpilih
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="toolbar">
            <input className="grow" type="search" placeholder="Cari nomor, pemohon, alur" value={props.query} onChange={(e) => props.setQuery(e.target.value)} aria-label="Cari tugas" />
            <select value={flow} onChange={(e) => setFlow(e.target.value)} aria-label="Saring alur">
              <option value="">Semua alur</option>
              {flows.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Urutkan">
              <option value="due">Tenggat terdekat</option>
              <option value="new">Terbaru masuk</option>
              <option value="requester">Nama pemohon</option>
            </select>
          </div>
        )}
        {bulk ? (
          <div className={`notice ${bulk.errors.length ? 'bad' : bulk.busy ? '' : 'ok'}`} role="status">
            {bulk.busy ? `Menyetujui… ${bulk.done} selesai` : `${bulk.done} permintaan disetujui.`}
            {bulk.errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
            {bulk.busy ? null : (
              <button className="icon-btn" onClick={() => setBulk(null)} aria-label="Tutup">
                <X size={16} />
              </button>
            )}
          </div>
        ) : null}
        <ErrorNote>{loadError}</ErrorNote>
        {!tasks && !loadError ? <Loading /> : null}
        {tasks && rows.length === 0 ? (
          filtersActive ? (
            <Empty title="Tidak ada tugas yang cocok">
              Ubah pencarian atau saringan.{' '}
              <button
                className="link"
                onClick={() => {
                  props.setQuery('');
                  setFlow('');
                  setLevel('');
                }}
              >
                Hapus saringan
              </button>
            </Empty>
          ) : (
            <Empty title="Tidak ada yang menunggu keputusan Anda">Tugas baru akan muncul di sini, diurutkan dari tenggat terdekat.</Empty>
          )
        ) : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="table inbox-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input type="checkbox" checked={allChecked} onChange={toggleAll} aria-label="Pilih semua" />
                  </th>
                  <th>Nomor</th>
                  <th>Alur dan langkah</th>
                  <th className="col-person">Pemohon</th>
                  <th className="col-tol">Tenggat</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.taskId}
                    className={`${props.selected === t.requestId ? 'selected' : ''} ${checked.has(t.taskId) ? 'checked' : ''}`}
                    onClick={() => (location.hash = `#/inbox/${t.requestId}`)}
                  >
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={checked.has(t.taskId)} onChange={() => toggle(t.taskId)} aria-label={`Pilih ${t.requestId}`} />
                    </td>
                    <td>
                      <a className="req-id" href={`#/inbox/${t.requestId}`} onClick={(e) => e.stopPropagation()}>
                        {t.requestId}
                      </a>
                    </td>
                    <td>
                      <div className="cell-main">{t.flowName}</div>
                      <div className="cell-sub">
                        {t.stepName}
                        {t.onBehalfOf ? <span className="tag">Delegasi</span> : null}
                      </div>
                    </td>
                    <td className="col-person">
                      <Person name={t.requesterName} />
                    </td>
                    <td className="col-tol">
                      <ToleranceBar createdAt={t.createdAt} dueAt={t.dueAt} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {props.selected ? (
        <section className="split-detail" aria-label="Detail permintaan">
          <RequestDetail id={props.selected} key={props.selected} embedded closeHref="#/inbox" onDecided={afterDecision} />
        </section>
      ) : (
        <section className="split-detail placeholder" aria-hidden="true">
          <p>Pilih tugas untuk melihat detail dan memutuskan.</p>
        </section>
      )}
    </div>
  );
}

/* ---------- Permintaan saya ---------- */

const REQ_FILTERS: [string, string][] = [
  ['', 'Semua'],
  ['in_progress', 'Diproses'],
  ['revision_requested', 'Perlu revisi'],
  ['approved', 'Disetujui'],
  ['rejected', 'Ditolak'],
];

export function MyRequests({ selected }: { selected?: string }) {
  const [requests, reload, error] = useLoad<any[]>('/requests');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const rows = (requests ?? []).filter(
    (r) => (!status || r.status === status) && (!q || `${r.id} ${r.flow_name}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  return (
    <div className={`split ${selected ? 'has-detail' : ''}`}>
      <section className="split-list" aria-label="Permintaan saya">
        <PageHead
          title="Permintaan saya"
          sub={requests ? `${requests.length} permintaan` : undefined}
          actions={
            <a className="btn primary" href="#/new">
              Buat permintaan
            </a>
          }
        />
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="Saring status">
            {REQ_FILTERS.map(([key, label]) => (
              <button key={key} className={status === key ? 'on' : ''} onClick={() => setStatus(key)} aria-pressed={status === key}>
                {label}
              </button>
            ))}
          </div>
          <input className="grow" type="search" placeholder="Cari nomor atau alur" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari permintaan" />
        </div>
        <ErrorNote>{error}</ErrorNote>
        {!requests && !error ? <Loading /> : null}
        {requests?.length === 0 ? (
          <Empty title="Belum ada permintaan">
            Ajukan cuti, akses IT, atau pembelian dari <a href="#/new">Buat permintaan</a>.
          </Empty>
        ) : requests && rows.length === 0 ? (
          <Empty title="Tidak ada permintaan dengan status ini" />
        ) : null}
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table className="table req-table">
              <thead>
                <tr>
                  <th>Nomor</th>
                  <th>Alur</th>
                  <th>Status</th>
                  <th className="col-wait">Menunggu</th>
                  <th className="col-time">Diajukan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={selected === r.id ? 'selected' : ''} onClick={() => (location.hash = `#/requests/${r.id}`)}>
                    <td>
                      <a className="req-id" href={`#/requests/${r.id}`} onClick={(e) => e.stopPropagation()}>
                        {r.id}
                      </a>
                    </td>
                    <td className="cell-main">{r.flow_name}</td>
                    <td>
                      <Badge status={r.status} />
                    </td>
                    <td className="col-wait">
                      {r.waiting?.length ? (
                        r.waiting.map((w: any, i: number) => (
                          <div key={i} className="req-wait">
                            <span className="cell-sub">
                              <strong className="wait-step">{w.stepName}</strong> {w.assignees.map((a: string) => splitName(a)[0]).join(' atau ')}
                            </span>
                            <ToleranceBar createdAt={w.createdAt} dueAt={w.dueAt} />
                          </div>
                        ))
                      ) : (
                        <span className="dim">{r.status === 'revision_requested' ? 'Menunggu perbaikan Anda' : 'Selesai'}</span>
                      )}
                    </td>
                    <td className="col-time num">{fmtTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
      {selected ? (
        <section className="split-detail" aria-label="Detail permintaan">
          <RequestDetail id={selected} key={selected} embedded closeHref="#/requests" onDecided={reload} />
        </section>
      ) : (
        <section className="split-detail placeholder" aria-hidden="true">
          <p>Pilih permintaan untuk melihat posisinya di alur.</p>
        </section>
      )}
    </div>
  );
}

export function NewRequest({ flowKey }: { flowKey?: string }) {
  const [flows, , loadError] = useLoad<any[]>('/flows');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (loadError) return <ErrorNote>{loadError}</ErrorNote>;
  if (!flows) return <Loading />;
  if (!flowKey) {
    return (
      <div className="page narrow">
        <PageHead title="Buat permintaan" sub="Pilih jenis permintaan. Approver ditentukan otomatis oleh alur yang berlaku." />
        <ul className="choice-list">
          {flows.map((f) => (
            <li key={f.key}>
              <a href={`#/new/${f.key}`} className="choice">
                <span>
                  <span className="cell-main">{f.name}</span>
                  <span className="cell-sub">{f.fields.map((x: Field) => x.label).join(', ')}</span>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
        {flows.length === 0 ? <Empty title="Belum ada alur yang berlaku" /> : null}
      </div>
    );
  }
  const flow = flows.find((f) => f.key === flowKey);
  if (!flow) return <Empty title="Alur tidak ditemukan atau belum berlaku" />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api('POST', '/requests', { flowKey, data });
      location.hash = `#/requests/${res.id}`;
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <div className="page narrow">
      <a className="back" href="#/new">
        <ArrowLeft size={16} /> Jenis permintaan
      </a>
      <PageHead title={flow.name} />
      <form className="sheet" onSubmit={submit}>
        <DynamicForm fields={flow.fields} value={data} onChange={setData} />
        <ErrorNote>{error}</ErrorNote>
        <div className="form-actions">
          <a className="btn ghost" href="#/new">
            Batal
          </a>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Mengirim…' : 'Kirim permintaan'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ---------- Detail permintaan ---------- */

const ACTION: Record<string, string> = {
  request_submitted: 'mengajukan permintaan',
  request_resubmitted: 'mengajukan ulang',
  task_created: 'menunggu',
  task_approved: 'menyetujui',
  task_rejected: 'menolak',
  task_revision_requested: 'meminta revisi',
  task_cancelled: 'tugas dibatalkan',
  task_reassigned: 'tugas dialihkan karena perubahan struktur ke',
  step_skipped: 'langkah tidak diperlukan',
  notification_requested: 'notifikasi dikirim',
  request_approved: 'permintaan disetujui',
  request_rejected: 'permintaan ditolak',
  request_revision_requested: 'dikembalikan untuk revisi',
  sla_reminder: 'pengingat tenggat dikirim',
  sla_escalated: 'eskalasi ke atasan',
  attachment_added: 'menambahkan lampiran',
  erp_synced: 'terkirim ke ERP',
  erp_sync_failed: 'gagal dikirim ke ERP',
};
const TIMELINE_TONE: Record<string, string> = {
  task_approved: 'ok',
  request_approved: 'ok',
  erp_synced: 'ok',
  task_rejected: 'bad',
  request_rejected: 'bad',
  erp_sync_failed: 'bad',
  sla_escalated: 'bad',
  task_revision_requested: 'warn',
  request_revision_requested: 'warn',
  sla_reminder: 'warn',
};

export function RequestPage({ id, onChanged }: { id: string; onChanged: () => void }) {
  return (
    <div className="page">
      <a className="back" href="#/requests">
        <ArrowLeft size={16} /> Permintaan saya
      </a>
      <RequestDetail id={id} onDecided={async () => onChanged()} />
    </div>
  );
}

const Section = ({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) => (
  <section className="detail-section">
    <div className="section-head">
      <h3>{title}</h3>
      {aside}
    </div>
    {children}
  </section>
);

export function RequestDetail(props: { id: string; embedded?: boolean; closeHref?: string; onDecided?: () => Promise<unknown> | void }) {
  const { id } = props;
  const [r, reload, loadError] = useLoad<any>(`/requests/${id}`);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState('');
  if (loadError) return <ErrorNote>{loadError}</ErrorNote>;
  if (!r) return <Loading />;
  const name = (uid?: string | null) => (uid ? (r.names[uid] ?? uid) : 'Sistem');
  const mine = r.tasks.find((t: any) => t.canAct);
  const run = async (label: string, fn: () => Promise<unknown>, after?: () => Promise<unknown> | void) => {
    setBusy(label);
    setError('');
    try {
      await fn();
      setComment('');
      if (after) await after();
      else await reload();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy('');
  };
  const decide = (type: string) =>
    run(type, () => api('POST', `/requests/${id}/decision`, { taskId: mine.id, type, comment: comment || undefined }), props.onDecided ?? reload);
  const upload = (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    run('upload', () => api('POST', `/requests/${id}/attachments`, form));
  };
  const [requester, requesterRole] = splitName(name(r.requesterId));

  return (
    <article className={`detail ${props.embedded ? 'embedded' : ''}`}>
      <header className="detail-head">
        {props.closeHref ? (
          <a className="icon-btn detail-close" href={props.closeHref} aria-label="Tutup detail">
            <X size={18} />
          </a>
        ) : null}
        <div className="detail-id">
          <span className="req-id big">{r.id}</span>
          <Badge status={r.status} />
        </div>
        <h2>{r.flowName}</h2>
        <p className="detail-meta">
          {requester}
          {requesterRole ? `, ${requesterRole}` : ''} · diajukan <span className="num">{fmtTime(r.createdAt)}</span> · alur versi {r.flowVersion}
          {r.round > 1 ? ` · pengajuan ke-${r.round}` : ''}
        </p>
      </header>

      {mine ? (
        <section className="decision" aria-label="Keputusan Anda">
          <div className="decision-head">
            <div>
              <h3>Keputusan Anda</h3>
              <p className="cell-sub">
                {mine.stepName}
                {mine.onBehalfOf ? ` · atas nama ${splitName(name(mine.onBehalfOf))[0]}` : ''}
              </p>
            </div>
            <ToleranceBar createdAt={mine.createdAt} dueAt={mine.dueAt} wide />
          </div>
          <label className="field">
            <span className="field-label">Komentar {comment ? '' : <span className="optional">opsional untuk setuju, dianjurkan untuk revisi atau tolak</span>}</span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} />
          </label>
          <ErrorNote>{error}</ErrorNote>
          <div className="decision-actions">
            <button className="btn primary" disabled={Boolean(busy)} onClick={() => decide('approve')}>
              <Check size={16} /> {busy === 'approve' ? 'Menyimpan…' : 'Setujui'}
            </button>
            <button className="btn" disabled={Boolean(busy)} onClick={() => decide('request_revision')}>
              <RotateCcw size={16} /> {busy === 'request_revision' ? 'Menyimpan…' : 'Minta revisi'}
            </button>
            <button className="btn danger" disabled={Boolean(busy)} onClick={() => decide('reject')}>
              <X size={16} /> {busy === 'reject' ? 'Menyimpan…' : 'Tolak'}
            </button>
          </div>
        </section>
      ) : null}

      {r.isRequester && r.status === 'revision_requested' ? (
        <form
          className="decision"
          onSubmit={(e) => {
            e.preventDefault();
            run('resubmit', () => api('POST', `/requests/${id}/resubmit`, { data: data ?? r.data }));
          }}
        >
          <h3>Perbaiki dan kirim ulang</h3>
          <p className="cell-sub">Lihat komentar approver di riwayat, ubah isian, lalu kirim ulang.</p>
          <DynamicForm fields={r.fields} value={data ?? r.data} onChange={setData} />
          <ErrorNote>{error}</ErrorNote>
          <div className="decision-actions">
            <button className="btn primary" disabled={Boolean(busy)}>
              {busy === 'resubmit' ? 'Mengirim…' : 'Kirim ulang'}
            </button>
          </div>
        </form>
      ) : null}

      <Section title="Isian">
        <dl className="spec">
          {r.fields.map((f: Field) => {
            const v = r.data[f.key];
            return (
              <div key={f.key} className={f.type === 'string' && String(v ?? '').length > 24 ? 'span-2' : ''}>
                <dt>{f.label}</dt>
                <dd className={f.type === 'number' || f.type === 'date' ? 'num' : ''}>
                  {v == null || v === '' ? <span className="dim">Tidak diisi</span> : f.type === 'number' ? fmtNumber(v) : f.type === 'date' ? fmtDate(String(v)) : f.type === 'boolean' ? (v ? 'Ya' : 'Tidak') : String(v)}
                </dd>
              </div>
            );
          })}
        </dl>
      </Section>

      <Section
        title={`Lampiran${r.attachments.length ? ` (${r.attachments.length})` : ''}`}
        aside={
          <label className="btn small file-btn">
            <Paperclip size={14} /> {busy === 'upload' ? 'Mengunggah…' : 'Tambah'}
            <input type="file" onChange={(e) => upload(e.target.files?.[0])} />
          </label>
        }
      >
        {r.attachments.length === 0 ? <p className="dim small">Belum ada lampiran.</p> : null}
        <ul className="files">
          {r.attachments.map((a: any) => (
            <li key={a.id}>
              <Paperclip size={14} aria-hidden="true" />
              <a href={`/api/attachments/${a.id}`}>{a.filename}</a>
              <span className="dim small">{splitName(name(a.uploaded_by))[0]}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Langkah approval">
        <ol className="steps">
          {r.tasks.map((t: any) => (
            <li key={t.id} className={`step ${t.status}`}>
              <span className="step-mark" aria-hidden="true" />
              <div className="step-body">
                <div className="step-line">
                  <strong>{t.stepName}</strong>
                  <Badge status={t.status} />
                </div>
                <div className="cell-sub">
                  {t.actedBy ? splitName(name(t.actedBy))[0] : t.assignees.map((u: string) => splitName(name(u))[0]).join(' atau ')}
                  {t.onBehalfOf ? ` (atas nama ${splitName(name(t.onBehalfOf))[0]})` : ''}
                  {t.actedAt ? (
                    <>
                      {' · '}
                      <span className="num">{fmtDuration(t.createdAt, t.actedAt)}</span>
                    </>
                  ) : null}
                </div>
                {t.basis ? <div className="basis">Ditunjuk sebagai {t.basis}</div> : null}
                {t.status === 'open' && t.dueAt ? <ToleranceBar createdAt={t.createdAt} dueAt={t.dueAt} /> : null}
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Riwayat">
        <ol className="timeline">
          {r.timeline.map((e: any) => (
            <li key={e.seq} className={TIMELINE_TONE[e.action] ?? ''}>
              <time className="num">{fmtTime(e.at)}</time>
              <div>
                <strong>{e.actorType === 'user' ? splitName(name(e.actorId))[0] : 'Sistem'}</strong> {ACTION[e.action] ?? e.action}
                {e.stepName ? <span className="dim"> · {e.stepName}</span> : null}
                {e.action === 'task_created' || e.action === 'task_reassigned' ? ` ${e.detail.assignees.map((u: string) => splitName(name(u))[0]).join(' atau ')}` : ''}
                {e.detail?.basis ? <span className="dim"> ({e.detail.basis})</span> : ''}
                {e.detail?.onBehalfOf ? ` atas nama ${splitName(name(e.detail.onBehalfOf))[0]}` : ''}
                {e.detail?.delegatedBy ? <span className="dim"> (delegasi dibuat oleh {splitName(name(e.detail.delegatedBy))[0]})</span> : ''}
                {e.detail?.reference ? <span className="num"> {e.detail.reference}</span> : ''}
                {e.detail?.comment ? <blockquote>{e.detail.comment}</blockquote> : null}
              </div>
            </li>
          ))}
        </ol>
      </Section>
    </article>
  );
}

/* ---------- Delegasi ---------- */

/**
 * Konfirmasi tanggal-waktu dalam format Indonesia 24 jam. Input bawaan browser memakai bahasa tampilan
 * browser (sering bahasa Inggris), jadi teks ini memastikan arti pilihan tanpa mengganti pemilih bawaan.
 */
const fmtLocal = (v: string) => {
  const d = new Date(v);
  return Number.isNaN(d.getTime())
    ? 'Tanggal belum valid'
    : d.toLocaleString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
};

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function Delegations({ me }: { me: Me }) {
  const [list, reload, loadError] = useLoad<any[]>('/delegations');
  const [users] = useLoad<any[]>('/users');
  const [reports] = useLoad<any[]>('/reports');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [start, setStart] = useState(localInput(new Date()));
  const [end, setEnd] = useState(localInput(new Date(Date.now() + 7 * 86_400_000)));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaved(false);
    try {
      await api('POST', '/delegations', { fromUserId: from || undefined, toUserId: to, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
      setTo('');
      setSaved(true);
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  };
  const now = Date.now();
  return (
    <div className="page">
      <PageHead title="Delegasi" sub="Alihkan approval sementara saat Anda atau bawahan Anda berhalangan. Semua keputusan tetap tercatat atas nama pemilik tugas." />
      <div className="two-col">
        <section>
          <ErrorNote>{loadError}</ErrorNote>
          {!list && !loadError ? <Loading /> : null}
          {list?.length === 0 ? <Empty title="Tidak ada delegasi aktif atau terjadwal" /> : null}
          {list?.length ? (
            <div className="table-wrap">
              <table className="table static">
                <thead>
                  <tr>
                    <th>Dari</th>
                    <th>Kepada</th>
                    <th>Periode</th>
                    <th>Status</th>
                    <th aria-label="Aksi" />
                  </tr>
                </thead>
                <tbody>
                  {list.map((d) => {
                    const state = Date.parse(d.starts_at) > now ? 'Terjadwal' : 'Aktif';
                    return (
                      <tr key={d.id}>
                        <td>
                          <Person name={d.from_name} />
                        </td>
                        <td>
                          <Person name={d.to_name} />
                        </td>
                        <td className="num">
                          {fmtTime(d.starts_at)} – {fmtTime(d.ends_at)}
                          {d.created_by && d.created_by !== d.from_user_id ? <div className="cell-sub">dibuat oleh {splitName(d.created_by_name)[0]}</div> : null}
                        </td>
                        <td>
                          <Badge status={state === 'Aktif' ? 'active' : 'open'} label={state} />
                        </td>
                        <td className="col-action">
                          {d.from_user_id === me.id || d.created_by === me.id ? (
                            <button className="btn small danger" onClick={() => api('DELETE', `/delegations/${d.id}`).then(reload)}>
                              Cabut
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </section>
        <form className="sheet" onSubmit={submit}>
          <h2>Buat delegasi</h2>
          {reports?.length ? (
            <label className="field">
              <span className="field-label">Approval milik</span>
              <select value={from} onChange={(e) => setFrom(e.target.value)}>
                <option value="">Saya sendiri</option>
                {reports.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}, bawahan yang berhalangan
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span className="field-label">Kepada</span>
            <select value={to} onChange={(e) => setTo(e.target.value)} required>
              <option value="">Pilih rekan</option>
              {users
                ?.filter((u) => u.id !== (from || me.id))
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">Mulai</span>
              <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
              <span className="field-hint">Terbaca sebagai {fmtLocal(start)}</span>
            </label>
            <label className="field">
              <span className="field-label">Selesai</span>
              <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
              <span className="field-hint">Terbaca sebagai {fmtLocal(end)}</span>
            </label>
          </div>
          <ErrorNote>{error}</ErrorNote>
          {saved ? <p className="ok-note">Delegasi tersimpan.</p> : null}
          <div className="form-actions">
            <button className="btn primary">Simpan delegasi</button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------- Notifikasi ---------- */

export function Notifications({ onRead }: { onRead: () => void }) {
  const [list, , error] = useLoad<any[]>('/notifications');
  useEffect(() => {
    if (list?.some((n) => !n.read_at)) api('POST', '/notifications/read').then(onRead, () => {});
  }, [list]);
  return (
    <div className="page narrow">
      <PageHead title="Notifikasi" sub="50 terakhir. Ditandai terbaca saat halaman ini dibuka." />
      <ErrorNote>{error}</ErrorNote>
      {!list && !error ? <Loading /> : null}
      {list?.length === 0 ? <Empty title="Belum ada notifikasi" /> : null}
      {list?.length ? (
        <ul className="notes">
          {list.map((n) => (
            <li key={n.id}>
              <a className={`note ${n.read_at ? '' : 'unread'}`} href={n.request_id ? `#/r/${n.request_id}` : '#/admin'}>
                <span className="note-dot" aria-label={n.read_at ? undefined : 'Belum dibaca'} />
                <span className="note-text">{n.message}</span>
                <time className="num">{fmtTime(n.created_at)}</time>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export { STATUS_LABEL };
