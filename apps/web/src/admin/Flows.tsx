import { useState, type FormEvent } from 'react';
import { api, fmtTime } from '../api';
import type { Me } from '../App';
import { Badge, useLoad } from '../pages';

function OwnersForm(props: { flowKey?: string; current: string[]; users: any[]; onDone: () => void }) {
  const [key, setKey] = useState(props.flowKey ?? '');
  const [picked, setPicked] = useState<string[]>(props.current);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('PUT', `/admin/flows/${key}/owners`, { userIds: picked });
      props.onDone();
    } catch (err: any) {
      setError(err.message);
    }
  };
  return (
    <form onSubmit={submit}>
      {props.flowKey ? null : (
        <label>
          <span>Kunci alur (huruf kecil, angka, _)</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} pattern="[a-z0-9_]+" required />
        </label>
      )}
      <label>
        <span>Pemilik proses (minimal dua)</span>
        <select multiple size={6} value={picked} onChange={(e) => setPicked([...e.target.selectedOptions].map((o) => o.value))}>
          {props.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.department})
            </option>
          ))}
        </select>
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="primary" disabled={picked.length < 2}>
        Simpan pemilik
      </button>
    </form>
  );
}

export function Flows({ me }: { me: Me }) {
  const [flows, reload] = useLoad<any[]>('/admin/flows');
  const [users] = useLoad<any[]>('/admin/users');
  const [editing, setEditing] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const create = async (flowKey: string, name?: string) => {
    setError('');
    try {
      const res = await api('POST', '/admin/drafts', { flowKey, name });
      location.hash = `#/admin/v/${res.id}`;
    } catch (e: any) {
      setError(e.message);
    }
  };
  const done = () => {
    setEditing(null);
    reload();
  };
  return (
    <>
      <h2>Alur approval</h2>
      <p className="muted small">
        {me.isAdmin
          ? 'Anda admin sistem: menunjuk pemilik proses tiap alur. Isi alur hanya bisa diubah dan diaktifkan oleh pemiliknya.'
          : 'Anda pemilik proses untuk alur di bawah ini. Draf yang Anda susun harus diaktifkan oleh pemilik lain di alur yang sama.'}
      </p>
      {error ? <p className="error">{error}</p> : null}
      {flows?.map((flow) => (
        <div key={flow.key} className="card">
          <div className="row">
            <h3 className="grow">{flow.name}</h3>
            {flow.canEdit && flow.versions.length > 0 ? <button onClick={() => create(flow.key)}>Buat draf perubahan</button> : null}
            {me.isAdmin ? (
              <button className="link" onClick={() => setEditing(editing === flow.key ? null : flow.key)}>
                Ubah pemilik
              </button>
            ) : null}
          </div>
          <p className="muted small">Pemilik proses: {flow.owners.map((o: any) => o.name).join(', ') || 'belum ditunjuk'}</p>
          {editing === flow.key && users ? (
            <OwnersForm flowKey={flow.key} current={flow.owners.map((o: any) => o.id)} users={users} onDone={done} />
          ) : null}
          {flow.canEdit && flow.versions.length === 0 ? (
            <div className="inline">
              <input placeholder="Nama alur" value={names[flow.key] ?? ''} onChange={(e) => setNames({ ...names, [flow.key]: e.target.value })} />
              <button className="primary" disabled={!names[flow.key]} onClick={() => create(flow.key, names[flow.key])}>
                Buat draf pertama
              </button>
            </div>
          ) : null}
          {flow.versions.map((v: any) => (
            <a key={v.id} className="row version" href={`#/admin/v/${v.id}`}>
              <span className="grow">
                Versi {v.version}
                <span className="muted">
                  {v.status === 'active'
                    ? ` · berlaku ${fmtTime(v.effective_from)} · diaktifkan ${v.activated_by_name ?? '-'}`
                    : ` · disusun ${v.edited_by.join(', ')}${flow.canEdit && !v.edited_by.includes(me.id) ? ' · menunggu tinjauan Anda' : ''}`}
                </span>
              </span>
              <Badge status={v.status} />
            </a>
          ))}
        </div>
      ))}
      {me.isAdmin && users ? (
        <div className="card">
          <h3>Daftarkan alur baru</h3>
          <OwnersForm current={[]} users={users} onDone={done} />
        </div>
      ) : null}
    </>
  );
}
