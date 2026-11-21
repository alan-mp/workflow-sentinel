import { useState, type FormEvent } from 'react';
import { api, fmtTime } from '../api';
import type { Me } from '../App';
import { Badge, useLoad } from '../pages';

export function Flows({ me }: { me: Me }) {
  const [versions] = useLoad<any[]>('/admin/versions');
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const create = async (flowKey: string, flowName?: string) => {
    setError('');
    try {
      const res = await api('POST', '/admin/drafts', { flowKey, name: flowName });
      location.hash = `#/admin/v/${res.id}`;
    } catch (e: any) {
      setError(e.message);
    }
  };
  const flows = [...new Set(versions?.map((v) => v.flow_key))];
  return (
    <>
      <h2>Alur approval</h2>
      {error ? <p className="error">{error}</p> : null}
      {flows.map((flowKey) => {
        const list = versions!.filter((v) => v.flow_key === flowKey);
        return (
          <div key={flowKey} className="card">
            <div className="row">
              <h3 className="grow">{list[0].name}</h3>
              <button onClick={() => create(flowKey)}>Buat draf perubahan</button>
            </div>
            {list.map((v) => (
              <a key={v.id} className="row version" href={`#/admin/v/${v.id}`}>
                <span className="grow">
                  Versi {v.version}
                  <span className="muted">
                    {v.status === 'active'
                      ? ` · berlaku ${fmtTime(v.effective_from)} · diaktifkan ${v.activated_by_name ?? '-'}`
                      : ` · disusun ${v.edited_by.join(', ')}${v.edited_by.includes(me.id) ? '' : ' · menunggu tinjauan Anda'}`}
                  </span>
                </span>
                <Badge status={v.status} />
              </a>
            ))}
          </div>
        );
      })}
      <form
        className="card"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          create(key, name);
        }}
      >
        <h3>Alur baru</h3>
        <label>
          <span>Nama</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          <span>Kunci (huruf kecil, angka, _)</span>
          <input value={key} onChange={(e) => setKey(e.target.value)} pattern="[a-z0-9_]+" required />
        </label>
        <button className="primary">Buat draf</button>
      </form>
    </>
  );
}
