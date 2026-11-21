import { useEffect, useState, type FormEvent } from 'react';
import type { Field } from '@sentinel/engine';
import { STATUS_LABEL, api, fmtDuration, fmtTime } from './api';
import type { Me } from './App';

export function useLoad<T>(url: string, deps: unknown[] = []): [T | undefined, () => void, string] {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const load = () => api<T>('GET', url).then(setData, (e) => setError(e.message));
  useEffect(() => {
    load();
  }, deps);
  return [data, load, error];
}

export const Badge = ({ status }: { status: string }) => <span className={`badge ${status}`}>{STATUS_LABEL[status] ?? status}</span>;

export function DynamicForm(props: {
  fields: Field[];
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => {
    const next = { ...props.value };
    if (v === '' || v === undefined || (typeof v === 'number' && Number.isNaN(v))) delete next[key];
    else next[key] = v;
    props.onChange(next);
  };
  return (
    <>
      {props.fields.map((f) => (
        <label key={f.key} className={f.type === 'boolean' ? 'check' : ''}>
          {f.type === 'boolean' ? (
            <input type="checkbox" checked={Boolean(props.value[f.key])} onChange={(e) => set(f.key, e.target.checked)} />
          ) : null}
          <span>
            {f.label}
            {f.optional ? <em className="muted"> (opsional)</em> : null}
          </span>
          {f.type === 'boolean' ? null : (
            <input
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              inputMode={f.type === 'number' ? 'decimal' : undefined}
              value={(props.value[f.key] as string | number | undefined) ?? ''}
              required={!f.optional}
              onChange={(e) => set(f.key, f.type === 'number' ? e.target.valueAsNumber : e.target.value)}
            />
          )}
        </label>
      ))}
    </>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('POST', '/login', { email, password });
      onDone();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <form className="login card" onSubmit={submit}>
      <h1>Sentinel Approval</h1>
      <label>
        <span>Email</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
      </label>
      <label>
        <span>Password</span>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="primary">Masuk</button>
    </form>
  );
}

export function Inbox() {
  const [tasks] = useLoad<any[]>('/inbox');
  if (!tasks) return null;
  return (
    <>
      <h2>Menunggu keputusan Anda</h2>
      {tasks.length === 0 ? <p className="muted">Tidak ada yang menunggu.</p> : null}
      {tasks.map((t) => {
        const late = t.dueAt && Date.parse(t.dueAt) < Date.now();
        return (
          <a key={t.taskId} className="card row" href={`#/r/${t.requestId}`}>
            <div className="grow">
              <strong>{t.flowName}</strong>
              <div className="muted">
                {t.requesterName} · {t.stepName}
                {t.onBehalfOf ? ' · delegasi' : ''}
              </div>
            </div>
            <div className={late ? 'late' : 'muted'}>{t.dueAt ? `Tenggat ${fmtTime(t.dueAt)}` : ''}</div>
          </a>
        );
      })}
    </>
  );
}

export function MyRequests() {
  const [flows] = useLoad<any[]>('/flows');
  const [requests] = useLoad<any[]>('/requests');
  return (
    <>
      <h2>Buat permintaan</h2>
      <div className="chips">
        {flows?.map((f) => (
          <a key={f.key} className="chip" href={`#/new/${f.key}`}>
            + {f.name}
          </a>
        ))}
      </div>
      <h2>Permintaan saya</h2>
      {requests?.length === 0 ? <p className="muted">Belum ada permintaan.</p> : null}
      {requests?.map((r) => (
        <a key={r.id} className="card row" href={`#/r/${r.id}`}>
          <div className="grow">
            <strong>{r.flow_name}</strong>
            <div className="muted">
              {r.id} · {fmtTime(r.created_at)}
            </div>
          </div>
          <Badge status={r.status} />
        </a>
      ))}
    </>
  );
}

export function NewRequest({ flowKey }: { flowKey: string }) {
  const [flows] = useLoad<any[]>('/flows');
  const [data, setData] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const flow = flows?.find((f) => f.key === flowKey);
  if (!flow) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const res = await api('POST', '/requests', { flowKey, data });
      location.hash = `#/r/${res.id}`;
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>{flow.name}</h2>
      <DynamicForm fields={flow.fields} value={data} onChange={setData} />
      {error ? <p className="error">{error}</p> : null}
      <button className="primary">Kirim</button>
    </form>
  );
}

const ACTION: Record<string, string> = {
  request_submitted: 'Permintaan dikirim',
  request_resubmitted: 'Permintaan dikirim ulang',
  task_created: 'Menunggu',
  task_approved: 'Menyetujui',
  task_rejected: 'Menolak',
  task_revision_requested: 'Meminta revisi',
  task_cancelled: 'Tugas dibatalkan',
  step_skipped: 'Langkah tidak diperlukan',
  notification_requested: 'Notifikasi dikirim',
  request_approved: 'Permintaan disetujui',
  request_rejected: 'Permintaan ditolak',
  request_revision_requested: 'Dikembalikan untuk revisi',
  sla_reminder: 'Pengingat tenggat',
  sla_escalated: 'Eskalasi ke atasan',
  attachment_added: 'Lampiran ditambahkan',
  erp_synced: 'Terkirim ke ERP',
  erp_sync_failed: 'Gagal kirim ke ERP',
};

export function RequestDetail({ id }: { id: string }) {
  const [r, reload, loadError] = useLoad<any>(`/requests/${id}`);
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  if (loadError) return <p className="error">{loadError}</p>;
  if (!r) return null;
  const name = (uid?: string | null) => (uid ? (r.names[uid] ?? uid) : 'Sistem');
  const mine = r.tasks.find((t: any) => t.canAct);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      setComment('');
      reload();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };
  const decide = (type: string) => run(() => api('POST', `/requests/${id}/decision`, { taskId: mine.id, type, comment: comment || undefined }));
  const upload = (file?: File) => {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    run(() => api('POST', `/requests/${id}/attachments`, form));
  };

  return (
    <>
      <div className="card">
        <div className="row">
          <h2 className="grow">{r.flowName}</h2>
          <Badge status={r.status} />
        </div>
        <p className="muted">
          {r.id} · oleh {name(r.requesterId)} · {fmtTime(r.createdAt)} · alur v{r.flowVersion}
        </p>
        <dl>
          {r.fields.map((f: Field) => (
            <div key={f.key}>
              <dt>{f.label}</dt>
              <dd>{f.type === 'number' && r.data[f.key] != null ? Number(r.data[f.key]).toLocaleString('id-ID') : String(r.data[f.key] ?? '-')}</dd>
            </div>
          ))}
        </dl>
        <h3>Lampiran</h3>
        {r.attachments.map((a: any) => (
          <div key={a.id}>
            <a href={`/api/attachments/${a.id}`}>{a.filename}</a> <span className="muted">· {name(a.uploaded_by)}</span>
          </div>
        ))}
        <label className="file">
          <span>+ Tambah lampiran</span>
          <input type="file" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      </div>

      {mine ? (
        <div className="card decision">
          <h3>Keputusan Anda: {mine.stepName}</h3>
          <textarea placeholder="Komentar" value={comment} onChange={(e) => setComment(e.target.value)} />
          {error ? <p className="error">{error}</p> : null}
          <div className="actions">
            <button className="primary" disabled={busy} onClick={() => decide('approve')}>
              Setujui
            </button>
            <button disabled={busy} onClick={() => decide('request_revision')}>
              Minta revisi
            </button>
            <button className="danger" disabled={busy} onClick={() => decide('reject')}>
              Tolak
            </button>
          </div>
        </div>
      ) : null}

      {r.isRequester && r.status === 'revision_requested' ? (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => api('POST', `/requests/${id}/resubmit`, { data: data ?? r.data }));
          }}
        >
          <h3>Perbaiki dan kirim ulang</h3>
          <DynamicForm fields={r.fields} value={data ?? r.data} onChange={setData} />
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" disabled={busy}>
            Kirim ulang
          </button>
        </form>
      ) : null}

      <div className="card">
        <h3>Langkah approval</h3>
        {r.tasks.map((t: any) => (
          <div key={t.id} className="row task">
            <div className="grow">
              <strong>{t.stepName}</strong>
              <div className="muted">
                {t.actedBy ? name(t.actedBy) : t.assignees.map(name).join(' atau ')}
                {t.onBehalfOf ? ` (atas nama ${name(t.onBehalfOf)})` : ''}
                {t.actedAt ? ` · ${fmtDuration(t.createdAt, t.actedAt)}` : t.dueAt && t.status === 'open' ? ` · tenggat ${fmtTime(t.dueAt)}` : ''}
              </div>
            </div>
            <Badge status={t.status} />
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Riwayat</h3>
        <ol className="timeline">
          {r.timeline.map((e: any) => (
            <li key={e.seq}>
              <span className="muted">{fmtTime(e.at)}</span> <strong>{e.actorType === 'user' ? name(e.actorId) : 'Sistem'}</strong>:{' '}
              {ACTION[e.action] ?? e.action}
              {e.stepName ? ` (${e.stepName})` : ''}
              {e.action === 'task_created' ? ` ${e.detail.assignees.map(name).join(' atau ')}` : ''}
              {e.detail?.reference ? ` ${e.detail.reference}` : ''}
              {e.detail?.comment ? <blockquote>{e.detail.comment}</blockquote> : null}
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function Delegations({ me }: { me: Me }) {
  const [list, reload] = useLoad<any[]>('/delegations');
  const [users] = useLoad<any[]>('/users');
  const [to, setTo] = useState('');
  const [start, setStart] = useState(localInput(new Date()));
  const [end, setEnd] = useState(localInput(new Date(Date.now() + 7 * 86_400_000)));
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('POST', '/delegations', { toUserId: to, startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString() });
      reload();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <>
      <h2>Delegasi</h2>
      {list?.length === 0 ? <p className="muted">Tidak ada delegasi aktif atau terjadwal.</p> : null}
      {list?.map((d) => (
        <div key={d.id} className="card row">
          <div className="grow">
            <strong>
              {d.from_name} → {d.to_name}
            </strong>
            <div className="muted">
              {fmtTime(d.starts_at)} sampai {fmtTime(d.ends_at)}
            </div>
          </div>
          {d.from_user_id === me.id ? (
            <button className="link" onClick={() => api('DELETE', `/delegations/${d.id}`).then(reload)}>
              Cabut
            </button>
          ) : null}
        </div>
      ))}
      <form className="card" onSubmit={submit}>
        <h3>Delegasikan approval saya</h3>
        <label>
          <span>Kepada</span>
          <select value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Pilih</option>
            {users?.filter((u) => u.id !== me.id).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Mulai</span>
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          <span>Selesai</span>
          <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="primary">Simpan</button>
      </form>
    </>
  );
}

export function Notifications() {
  const [list] = useLoad<any[]>('/notifications');
  useEffect(() => {
    if (list?.some((n) => !n.read_at)) api('POST', '/notifications/read');
  }, [list]);
  return (
    <>
      <h2>Notifikasi</h2>
      {list?.length === 0 ? <p className="muted">Belum ada notifikasi.</p> : null}
      {list?.map((n) => (
        <a key={n.id} className={`card row ${n.read_at ? '' : 'unread'}`} href={n.request_id ? `#/r/${n.request_id}` : '#/admin'}>
          <div className="grow">{n.message}</div>
          <div className="muted">{fmtTime(n.created_at)}</div>
        </a>
      ))}
    </>
  );
}
