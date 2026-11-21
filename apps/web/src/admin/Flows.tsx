import { useState, type FormEvent } from 'react';
import { ChevronRight } from 'lucide-react';
import { api, fmtDate } from '../api';
import type { Me } from '../App';
import { useLoad } from '../pages';
import { Badge, Empty, ErrorNote, Loading, PageHead, splitName } from '../ui';

function OwnersForm(props: { flowKey?: string; current: string[]; users: any[]; onDone: () => void; onCancel?: () => void }) {
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
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <form className="owners-form" onSubmit={submit}>
      {props.flowKey ? null : (
        <label className="field">
          <span className="field-label">Kunci alur (huruf kecil, angka, garis bawah)</span>
          <input className="num" value={key} onChange={(e) => setKey(e.target.value)} pattern="[a-z0-9_]+" required />
        </label>
      )}
      <fieldset className="field">
        <legend className="field-label">Pemilik proses, minimal dua ({picked.length} dipilih)</legend>
        <div className="owner-grid">
          {props.users.map((u) => (
            <label key={u.id} className="check">
              <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
              <span>
                {splitName(u.name)[0]} <span className="dim">{u.department}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <ErrorNote>{error}</ErrorNote>
      <div className="form-actions">
        {props.onCancel ? (
          <button type="button" className="btn ghost" onClick={props.onCancel}>
            Batal
          </button>
        ) : null}
        <button className="btn primary" disabled={picked.length < 2}>
          Simpan pemilik
        </button>
      </div>
    </form>
  );
}

export function Flows({ me }: { me: Me }) {
  const [flows, reload, loadError] = useLoad<any[]>('/admin/flows');
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
    <div className="page">
      <PageHead
        title="Alur approval"
        sub={
          me.isAdmin
            ? 'Anda admin sistem: menunjuk pemilik proses tiap alur. Isi alur hanya bisa diubah dan diaktifkan oleh pemiliknya.'
            : 'Anda pemilik proses alur di bawah ini. Draf yang Anda susun harus diaktifkan oleh pemilik lain di alur yang sama.'
        }
      />
      <ErrorNote>{error || loadError}</ErrorNote>
      {!flows && !loadError ? <Loading /> : null}
      {flows?.length === 0 ? <Empty title="Belum ada alur terdaftar" /> : null}
      <div className="flow-list">
        {flows?.map((flow) => (
          <section key={flow.key} className="sheet flow">
            <header className="flow-head">
              <div>
                <h2>{flow.name}</h2>
                <p className="cell-sub">
                  <span className="num">{flow.key}</span> · Pemilik proses: {flow.owners.map((o: any) => splitName(o.name)[0]).join(', ') || 'belum ditunjuk'}
                </p>
              </div>
              <div className="flow-actions">
                {me.isAdmin ? (
                  <button className="btn small" onClick={() => setEditing(editing === flow.key ? null : flow.key)}>
                    Ubah pemilik
                  </button>
                ) : null}
                {flow.canEdit && flow.versions.length > 0 ? (
                  <button className="btn small primary" onClick={() => create(flow.key)}>
                    Buat draf perubahan
                  </button>
                ) : null}
              </div>
            </header>
            {editing === flow.key && users ? (
              <OwnersForm flowKey={flow.key} current={flow.owners.map((o: any) => o.id)} users={users} onDone={done} onCancel={() => setEditing(null)} />
            ) : null}
            {flow.canEdit && flow.versions.length === 0 ? (
              <div className="toolbar">
                <input className="grow" placeholder="Nama alur, misalnya Permintaan Pembelian" value={names[flow.key] ?? ''} onChange={(e) => setNames({ ...names, [flow.key]: e.target.value })} />
                <button className="btn primary" disabled={!names[flow.key]} onClick={() => create(flow.key, names[flow.key])}>
                  Buat draf pertama
                </button>
              </div>
            ) : null}
            {flow.versions.length ? (
              <ul className="versions">
                {flow.versions.map((v: any) => {
                  const waiting = v.status === 'draft' && flow.canEdit && !v.edited_by.includes(me.id);
                  return (
                    <li key={v.id}>
                      <a href={`#/admin/v/${v.id}`} className="version">
                        <span className="num version-n">v{v.version}</span>
                        <Badge status={v.status} />
                        <span className="grow cell-sub">
                          {v.status === 'active'
                            ? `berlaku ${fmtDate(v.effective_from)} · diaktifkan ${v.activated_by_name ? splitName(v.activated_by_name)[0] : '-'}`
                            : `disusun ${v.edited_by.map((uid: string) => splitName(flow.owners.find((o: any) => o.id === uid)?.name ?? uid)[0]).join(', ')}`}
                        </span>
                        {waiting ? <span className="tag warn">Menunggu tinjauan Anda</span> : null}
                        <ChevronRight size={16} aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ))}
        {me.isAdmin && users ? (
          <section className="sheet flow">
            <h2>Daftarkan alur baru</h2>
            <OwnersForm current={[]} users={users} onDone={done} />
          </section>
        ) : null}
      </div>
    </div>
  );
}
