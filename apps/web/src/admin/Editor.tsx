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
        <a className="icon-btn" href="#/admin" aria-label="Back to flow list" title="Flow list">
          <ArrowLeft size={18} />
        </a>
        <input className="flow-name" value={def.name} disabled={readOnly} onChange={(e) => change({ ...def, name: e.target.value })} aria-label="Flow name" />
        <span className="num version-n">v{version.version}</span>
        <Badge status={version.status} label={STATUS_LABEL[version.status]} />
        <span className="grow" />
        {readOnly ? (
          <span className="cell-sub">{version.status === 'draft' ? 'Read only' : `Effective from ${fmtDate(version.effectiveFrom)}`}</span>
        ) : (
          <>
            <button className="btn" disabled={!dirty} onClick={() => run(save, 'Draft saved.')}>
              {dirty ? 'Save draft' : 'Saved'}
            </button>
            {version.canActivate ? (
              <>
                <label className="inline-field">
                  <span>Effective from</span>
                  <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} />
                </label>
                <button
                  className="btn primary"
                  disabled={dirty || errors.length > 0}
                  onClick={() => run(() => api('POST', `/admin/drafts/${id}/activate`, { effectiveFrom: new Date(`${effective}T00:00:00`).toISOString() }), 'Flow activated.')}
                >
                  Approve and activate
                </button>
              </>
            ) : (
              <button
                className="btn primary"
                disabled={errors.length > 0}
                title="You edited this draft, so another process owner must activate it"
                onClick={() => run(async () => { await save(); await api('POST', `/admin/drafts/${id}/submit`); }, 'Submitted to the other process owners for review.')}
              >
                Submit for review
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
                ['chat', 'AI chat'],
                ['step', 'Step'],
                ['tables', `Rule tables (${def.tables.length})`],
                ['sim', 'Simulation'],
                ['issues', `Checks${errors.length ? ` (${errors.length})` : ''}`],
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
                <p className="dim">Select a step in the diagram, or press + between steps to add one.</p>
              </div>
            )
          ) : null}
          {tab === 'tables' ? <TablesPanel def={def} roles={version.roles} citations={version.citations} readOnly={readOnly} onChange={change} /> : null}
          {tab === 'sim' ? <SimPanel def={def} /> : null}
          {tab === 'issues' ? (
            <div className="panel">
              <label className="field">
                <span className="field-label">Source SOP link</span>
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
              {!sopUrl ? <p className="check-row bad">Add the SOP link before this flow can be activated.</p> : null}
              {issues.length === 0 ? <p className="check-row ok">The definition passed all checks: every path has an approval and all references are valid.</p> : null}
              {issues.map((i, n) => (
                <p key={n} className={`check-row ${i.level === 'error' ? 'bad' : 'warn'}`}>
                  {i.message}
                </p>
              ))}
              <p className="dim small">
                Edited by: {version.editedBy.map((uid: string) => people[uid] ?? uid).join(', ')}. {version.canActivate
                  ? me.isAdmin && version.editedBy.includes(me.id)
                    ? 'You can activate this draft. Because you edited it, activation is recorded as an administrator override.'
                    : 'You can activate this draft.'
                  : readOnly
                    ? ''
                    : 'You edited this draft, so another process owner of this flow must activate it.'}
              </p>
              <h4>Request fields</h4>
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
