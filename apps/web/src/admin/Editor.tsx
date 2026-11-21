import { useEffect, useMemo, useState } from 'react';
import { flattenSteps, validateDefinition, type FlowDefinition } from '@sentinel/engine/model';
import { ArrowLeft } from 'lucide-react';
import { STATUS_LABEL, api, fmtDate } from '../api';
import type { Me } from '../App';
import { Badge, Loading, splitName } from '../ui';
import { Diagram } from './Diagram';
import { ChatPanel, SimPanel, StepPanel, TablesPanel } from './Panels';
import { insertStep, newStep, removeStep, setAuthorityNames, updateStep } from './edit';

type Tab = 'chat' | 'step' | 'tables' | 'sim' | 'issues';

export function Editor({ id, me }: { id: string; me: Me }) {
  const [version, setVersion] = useState<any>(null);
  const [def, setDef] = useState<FlowDefinition | null>(null);
  const [sopUrl, setSopUrl] = useState('');
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('chat');
  const [message, setMessage] = useState('');
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10));
  const [people, setPeople] = useState<Record<string, string>>({});
  useEffect(() => {
    api<any[]>('GET', '/admin/users').then((u) => setPeople(Object.fromEntries(u.map((x) => [x.id, splitName(x.name)[0]]))), () => {});
  }, []);

  const load = async () => {
    const v = await api('GET', `/admin/versions/${id}`);
    setAuthorityNames(v.roleNames ?? {});
    setVersion(v);
    setDef(v.definition);
    setSopUrl(v.sopUrl ?? '');
    setDirty(false);
  };
  useEffect(() => {
    load().catch((e) => setMessage(e.message));
  }, [id]);

  const issues = useMemo(() => (def ? validateDefinition(def).issues : []), [def]);
  const errors = issues.filter((i) => i.level === 'error');
  if (!version || !def) return message ? <p className="error-note page">{message}</p> : <Loading />;

  const readOnly = version.status !== 'draft' || !version.canEdit;
  const change = (next: FlowDefinition) => {
    setDef(next);
    setDirty(true);
  };
  const step = flattenSteps(def.steps).find((s) => s.id === selected);
  const save = async () => {
    if (!dirty) return;
    await api('PUT', `/admin/drafts/${id}`, { definition: def, sopUrl });
    setDirty(false);
  };
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setMessage('');
    try {
      await fn();
      setMessage(ok);
      await load();
    } catch (e: any) {
      setMessage(e.message);
    }
  };

  return (
    <div className="editor">
      <div className="editor-bar">
        <a className="icon-btn" href="#/admin" aria-label="Kembali ke daftar alur" title="Daftar alur">
          <ArrowLeft size={18} />
        </a>
        <input className="flow-name" value={def.name} disabled={readOnly} onChange={(e) => change({ ...def, name: e.target.value })} aria-label="Nama alur" />
        <span className="num version-n">v{version.version}</span>
        <Badge status={version.status} label={STATUS_LABEL[version.status]} />
        <span className="grow" />
        {readOnly ? (
          <span className="cell-sub">{version.status === 'draft' ? 'Hanya baca' : `Berlaku sejak ${fmtDate(version.effectiveFrom)}`}</span>
        ) : (
          <>
            <button className="btn" disabled={!dirty} onClick={() => run(save, 'Draf tersimpan.')}>
              {dirty ? 'Simpan draf' : 'Tersimpan'}
            </button>
            {version.canActivate ? (
              <>
                <label className="inline-field">
                  <span>Berlaku</span>
                  <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
                </label>
                <button
                  className="btn primary"
                  disabled={dirty || errors.length > 0}
                  onClick={() => run(() => api('POST', `/admin/drafts/${id}/activate`, { effectiveFrom: new Date(`${effective}T00:00:00`).toISOString() }), 'Alur diaktifkan.')}
                >
                  Setujui dan aktifkan
                </button>
              </>
            ) : (
              <button
                className="btn primary"
                disabled={errors.length > 0}
                title="Anda ikut menyusun draf ini, jadi pengaktifan harus oleh pemilik proses lain"
                onClick={() => run(async () => { await save(); await api('POST', `/admin/drafts/${id}/submit`); }, 'Diajukan ke pemilik proses lain untuk ditinjau.')}
              >
                Ajukan untuk ditinjau
              </button>
            )}
          </>
        )}
      </div>
      {message ? <div className="notice">{message}</div> : null}
      <div className="editor-body">
        <div className="canvas">
          <Diagram
            def={def}
            selected={selected}
            readOnly={readOnly}
            issues={new Set()}
            onSelect={(sid) => {
              setSelected(sid);
              setTab('step');
            }}
            onAdd={(seq, index, type) => {
              const fresh = newStep(def, type);
              change(insertStep(def, seq, index, fresh));
              setSelected(fresh.id);
              setTab('step');
            }}
          />
        </div>
        <aside className="side">
          <nav className="side-tabs">
            {(
              [
                ['chat', 'Chat AI'],
                ['step', 'Langkah'],
                ['tables', `Tabel aturan (${def.tables.length})`],
                ['sim', 'Simulasi'],
                ['issues', `Pemeriksaan${errors.length ? ` (${errors.length})` : ''}`],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button key={key} className={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </nav>
          {tab === 'chat' ? <ChatPanel draftId={id} chat={version.chat} sop={version.sop} readOnly={readOnly} beforeSend={save} onDone={load} /> : null}
          {tab === 'step' ? (
            step ? (
              <StepPanel
                key={step.id}
                step={step}
                def={def}
                roles={version.roles}
                citations={version.citations}
                readOnly={readOnly}
                onChange={(next) => change(updateStep(def, step.id, next))}
                onDelete={() => {
                  change(removeStep(def, step.id));
                  setSelected(null);
                }}
              />
            ) : (
              <div className="panel">
                <p className="dim">Pilih langkah di diagram, atau tekan + di antara langkah untuk menambah.</p>
              </div>
            )
          ) : null}
          {tab === 'tables' ? <TablesPanel def={def} roles={version.roles} citations={version.citations} readOnly={readOnly} onChange={change} /> : null}
          {tab === 'sim' ? <SimPanel def={def} /> : null}
          {tab === 'issues' ? (
            <div className="panel">
              <label className="field">
                <span className="field-label">Tautan SOP sumber</span>
                <input
                  value={sopUrl}
                  disabled={readOnly}
                  placeholder="https://..."
                  onChange={(e) => {
                    setSopUrl(e.target.value);
                    setDirty(true);
                  }}
                />
              </label>
              {!sopUrl ? <p className="check-row bad">Tautan SOP wajib diisi sebelum alur bisa diaktifkan.</p> : null}
              {issues.length === 0 ? <p className="check-row ok">Definisi lolos pemeriksaan: tidak ada jalur tanpa approval, semua rujukan valid.</p> : null}
              {issues.map((i, n) => (
                <p key={n} className={`check-row ${i.level === 'error' ? 'bad' : 'warn'}`}>
                  {i.message}
                </p>
              ))}
              <p className="dim small">
                Disusun oleh: {version.editedBy.map((uid: string) => people[uid] ?? uid).join(', ')}. {version.canActivate ? 'Anda bisa mengaktifkan draf ini.' : readOnly ? '' : 'Anda ikut menyusun, jadi pengaktifan harus oleh pemilik proses lain di alur ini.'}
              </p>
              <h4>Bidang isian permintaan</h4>
              <dl className="spec">
                {def.fields.map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd className="num">
                      {f.key} · {f.type}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
