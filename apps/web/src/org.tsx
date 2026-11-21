import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { UNIT_LEVELS, UNIT_LEVEL_LABEL, type UnitLevel } from '@sentinel/engine/model';
import { api, fmtDate, fmtTime } from './api';
import { useLoad } from './pages';
import { Badge, Empty, ErrorNote, Loading, PageHead, Person, splitName } from './ui';

interface Unit {
  id: string;
  name: string;
  level: UnitLevel;
  parentId?: string;
  headUserId?: string;
  actingHeadUserId?: string;
  actingUntil?: string;
}
interface OrgUser {
  id: string;
  name: string;
  email: string;
  unitId?: string;
  title?: string;
}
interface Finding {
  level: 'error' | 'warning';
  code: string;
  message: string;
  unitId?: string;
  userId?: string;
  authorityId?: string;
}
interface Holder {
  userId: string;
  scopeUnitId?: string;
}
interface Exception {
  id: string;
  userId: string;
  toUserId: string;
  flowKey?: string;
  reason: string;
  startsAt: string;
  endsAt: string;
}
interface Org {
  units: Unit[];
  users: OrgUser[];
  exceptions: Exception[];
  authorities: { id: string; name: string; description: string }[];
  holders: Record<string, Holder[]>;
  findings: Finding[];
  usage: Record<string, string[]>;
  loads: Record<string, number>;
  owners: { user_id: string; name: string }[];
  pending: number;
  canEdit: boolean;
  isAdmin: boolean;
}

const TABS: [string, string][] = [
  ['pohon', 'Tree'],
  ['karyawan', 'People'],
  ['wewenang', 'Authority matrix'],
  ['pengecualian', 'Reporting exceptions'],
  ['perubahan', 'Changes'],
  ['cakupan', 'Coverage test'],
];
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const short = (name?: string) => (name ? splitName(name)[0] : '-');

/** Formulir usulan: setiap perubahan butuh catatan opsional dan tanggal berlaku, lalu menunggu tinjauan orang kedua. */
function Propose(props: { change: () => object | string; label: string; onDone: (res?: any) => void; disabled?: boolean; children?: ReactNode }) {
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const change = props.change();
    if (typeof change === 'string') return setError(change);
    setBusy(true);
    setError('');
    try {
      const res = await api('POST', '/org/changes', { change, note, effectiveFrom: date > today() ? new Date(`${date}T00:00:00`).toISOString() : undefined });
      setNote('');
      props.onDone(res);
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };
  return (
    <form className="propose" onSubmit={submit}>
      {props.children}
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Effective from</span>
          <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">
            Note for the reviewer <span className="optional">optional</span>
          </span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="form-actions">
        <button className="btn primary" disabled={busy || props.disabled}>
          {busy ? 'Submitting…' : props.label}
        </button>
      </div>
    </form>
  );
}

const Mark = ({ findings }: { findings: Finding[] }) =>
  findings.length ? (
    <span className={`mark ${findings.some((f) => f.level === 'error') ? 'bad' : 'warn'}`} title={findings.map((f) => f.message).join('\n')}>
      {findings.length}
    </span>
  ) : null;

export function Organization({ tab = 'pohon', selected }: { tab?: string; selected?: string }) {
  const [org, reload, error] = useLoad<Org>('/org');
  const [sent, setSent] = useState<'' | 'pending' | 'applied' | 'scheduled'>('');
  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>;
  if (!org) return <Loading />;
  const done = (res?: any) => {
    setSent(res?.status ?? 'pending');
    reload();
  };
  const errors = org.findings.filter((f) => f.level === 'error').length;
  const warnings = org.findings.length - errors;
  const props = { org, done, selected };
  return (
    <div className="org">
      <div className="org-head">
        <PageHead
          title="Organization"
          sub={
            org.isAdmin
              ? 'You are a system administrator: your changes apply immediately and are recorded as an administrator override.'
              : org.canEdit
                ? 'Superiors are derived from the unit tree, and authority from the matrix. You propose each change, and another organization owner reviews it before it takes effect.'
                : 'The structure and authorities used by approval flows. Only organization owners can change them.'
          }
        />
        <div className="gauge" role="group" aria-label="Structure health">
          <a className="gauge-seg out" href="#/org/pohon">
            <span className="gauge-n">{errors}</span> Routing may dead-end
          </a>
          <a className="gauge-seg near" href="#/org/pohon">
            <span className="gauge-n">{warnings}</span> Needs attention
          </a>
          <a className="gauge-seg" href="#/org/perubahan">
            <span className="gauge-n">{org.pending}</span> Pending proposals
          </a>
          <span className="gauge-seg static">
            <span className="gauge-n">{org.users.length}</span> people in {org.units.length} units
          </span>
        </div>
        {sent ? (
          <div className="notice ok" role="status">
            {sent === 'applied' ? 'Change applied immediately and recorded as an administrator override.' : sent === 'scheduled' ? 'Change scheduled and recorded as an administrator override.' : 'Proposal submitted. The change takes effect after another organization owner approves it.'}{' '}
            <a href="#/org/perubahan">View proposals</a>
            <button className="icon-btn" onClick={() => setSent('')} aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        ) : null}
        <nav className="side-tabs org-tabs" aria-label="Organization sections">
          {[...TABS, ...(org.isAdmin ? [['pengaturan', 'Settings'] as [string, string]] : [])].map(([key, label]) => (
            <a key={key} href={`#/org/${key}`} className={tab === key ? 'on' : ''} aria-current={tab === key ? 'page' : undefined}>
              {label}
              {key === 'perubahan' && org.pending ? <span className="nav-count">{org.pending}</span> : null}
            </a>
          ))}
        </nav>
      </div>
      {tab === 'karyawan' ? <People {...props} /> : null}
      {tab === 'wewenang' ? <Authorities {...props} /> : null}
      {tab === 'pengecualian' ? <Exceptions {...props} /> : null}
      {tab === 'perubahan' ? <Changes onDone={reload} /> : null}
      {tab === 'cakupan' ? <Coverage /> : null}
      {tab === 'pengaturan' && org.isAdmin ? <Settings org={org} onDone={reload} /> : null}
      {!TABS.some(([k]) => k === tab && k !== 'pohon') && tab !== 'pengaturan' ? <Tree {...props} /> : null}
    </div>
  );
}

type TabProps = { org: Org; done: (res?: any) => void; selected?: string };

/* ---------- Pohon ---------- */

function Tree({ org, done, selected }: TabProps) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const users = useMemo(() => new Map(org.users.map((u) => [u.id, u])), [org]);
  const children = (parentId?: string) => org.units.filter((u) => (u.parentId ?? undefined) === parentId).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const members = (unitId: string) => org.users.filter((u) => u.unitId === unitId);
  const unplaced = org.users.filter((u) => !u.unitId || !org.units.some((x) => x.id === u.unitId));
  const term = q.trim().toLowerCase();
  const hit = (text: string) => !term || text.toLowerCase().includes(term);
  /** Unit tampil kalau ia, anggotanya, atau unit di bawahnya cocok dengan pencarian. */
  const visible = (unit: Unit): boolean => hit(unit.name) || members(unit.id).some((m) => hit(m.name) || hit(m.title ?? '')) || children(unit.id).some(visible);
  const authorityOf = (userId: string) => org.authorities.filter((a) => (org.holders[a.id] ?? []).some((h) => h.userId === userId));
  const now = new Date().toISOString();
  const activeException = (userId: string) => org.exceptions.find((e) => e.userId === userId && e.startsAt <= now && now < e.endsAt);

  const row = (unit: Unit, depth: number): ReactNode => {
    if (!visible(unit)) return null;
    const open = term ? true : !closed.has(unit.id);
    const kids = children(unit.id);
    const people = members(unit.id).filter((m) => m.id !== unit.headUserId);
    const head = unit.headUserId ? users.get(unit.headUserId) : undefined;
    const acting = !head && unit.actingHeadUserId && (!unit.actingUntil || unit.actingUntil > now) ? users.get(unit.actingHeadUserId) : undefined;
    const marks = org.findings.filter((f) => f.unitId === unit.id);
    const toggle = () => {
      const next = new Set(closed);
      if (open) next.add(unit.id);
      else next.delete(unit.id);
      setClosed(next);
    };
    return (
      <li key={unit.id}>
        <div className={`tree-row unit ${selected === unit.id ? 'selected' : ''}`} style={{ paddingLeft: `${0.5 + depth * 1.4}rem` }}>
          <button className="icon-btn tree-toggle" onClick={toggle} aria-label={open ? `Collapse ${unit.name}` : `Expand ${unit.name}`} aria-expanded={open} disabled={kids.length + people.length === 0}>
            {kids.length + people.length === 0 ? null : open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <a className="tree-main" href={`#/org/pohon/${unit.id}`}>
            <span className="cell-main">{unit.name}</span>
            <span className="tag">{UNIT_LEVEL_LABEL[unit.level]}</span>
            <Mark findings={marks} />
          </a>
          <span className="tree-head">
            {head ? <Person name={head.name} sub={head.title ?? 'Head'} compact={false} /> : acting ? <Person name={acting.name} sub={`Acting head until ${fmtDate(unit.actingUntil)}`} /> : <span className="badge bad">No head</span>}
          </span>
          <span className="tree-count num">{members(unit.id).length}</span>
        </div>
        {open ? (
          <ul className="tree-list">
            {people
              .filter((m) => !term || hit(m.name) || hit(m.title ?? '') || hit(unit.name))
              .map((m) => (
                <li key={m.id}>
                  <a className={`tree-row person-row ${selected === m.id ? 'selected' : ''}`} style={{ paddingLeft: `${2.6 + depth * 1.4}rem` }} href={`#/org/pohon/${m.id}`}>
                    <Person name={m.name} sub={m.title} />
                    <span className="tree-tags">
                      {authorityOf(m.id).map((a) => (
                        <span key={a.id} className="tag blue">
                          {a.name}
                        </span>
                      ))}
                      {activeException(m.id) ? <span className="tag warn">Reporting exception</span> : null}
                    </span>
                    {org.loads[m.id] ? <span className="tree-count num" title="Open tasks">{org.loads[m.id]}</span> : <span className="tree-count" />}
                  </a>
                </li>
              ))}
            {kids.map((k) => row(k, depth + 1))}
          </ul>
        ) : null}
      </li>
    );
  };

  const unit = org.units.find((u) => u.id === selected);
  const person = org.users.find((u) => u.id === selected);
  return (
    <div className={`split org-split ${unit || person ? 'has-detail' : ''}`}>
      <section className="split-list" aria-label="Organization tree">
        <div className="toolbar">
          <input className="grow" type="search" placeholder="Search by unit, name, or title" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the tree" />
          <button className="btn" onClick={() => setClosed(closed.size ? new Set() : new Set(org.units.map((u) => u.id)))}>
            {closed.size ? 'Expand all' : 'Collapse all'}
          </button>
        </div>
        {org.units.length === 0 ? (
          <Empty title="No organization units yet">A system administrator can import the unit list on the Settings tab, or an organization owner can add a top-level unit in the panel on the right.</Empty>
        ) : (
          <div className="tree" role="tree">
            <div className="tree-cols">
              <span>Unit and members</span>
              <span>Head</span>
              <span>People</span>
            </div>
            <ul className="tree-list">{children(undefined).map((u) => row(u, 0))}</ul>
          </div>
        )}
        {unplaced.length ? (
          <div className="tree unplaced">
            <div className="tree-cols">
              <span>Not placed in a unit ({unplaced.length})</span>
            </div>
            <ul className="tree-list">
              {unplaced
                .filter((m) => hit(m.name))
                .map((m) => (
                  <li key={m.id}>
                    <a className={`tree-row person-row ${selected === m.id ? 'selected' : ''}`} href={`#/org/pohon/${m.id}`}>
                      <Person name={m.name} sub={m.title} />
                      <span className="badge bad">No approval path</span>
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section className={`split-detail ${unit || person ? '' : 'placeholder'}`} aria-label="Details">
        {unit ? <UnitDetail key={unit.id} unit={unit} org={org} done={done} /> : person ? <PersonDetail key={person.id} person={person} org={org} done={done} /> : <RootPanel org={org} done={done} />}
      </section>
    </div>
  );
}

function RootPanel({ org, done }: { org: Org; done: (res?: any) => void }) {
  const general = org.findings.filter((f) => !f.unitId && !f.userId);
  return (
    <div className="org-root">
      <p>Select a unit or person to see details{org.canEdit ? ' and propose changes' : ''}.</p>
      {general.length ? <h3>Authority findings</h3> : null}
      {general.length ? (
        <ul className="finding-list">
          {general.map((f, i) => (
            <li key={i} className={f.level === 'error' ? 'bad' : 'warn'}>
              {f.message}
            </li>
          ))}
        </ul>
      ) : null}
      {org.canEdit && org.units.length === 0 ? <UnitForm org={org} done={done} /> : null}
    </div>
  );
}

function UnitForm({ org, done, parent, unit }: { org: Org; done: (res?: any) => void; parent?: Unit; unit?: Unit }) {
  const [name, setName] = useState(unit?.name ?? '');
  const below = parent ? UNIT_LEVELS.slice(UNIT_LEVELS.indexOf(parent.level) + 1) : [...UNIT_LEVELS];
  const [level, setLevel] = useState<UnitLevel>(unit?.level ?? below[0] ?? 'seksi');
  const [parentId, setParentId] = useState(unit ? (unit.parentId ?? '') : (parent?.id ?? ''));
  return (
    <Propose label={unit ? 'Propose unit change' : 'Propose new unit'} onDone={done} change={() => ({ kind: 'unit_upsert', id: unit?.id, name, level, parentId: parentId || null })}>
      <label className="field">
        <span className="field-label">Unit name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Level</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as UnitLevel)}>
            {(unit ? UNIT_LEVELS : below).map((l) => (
              <option key={l} value={l}>
                {UNIT_LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Parent unit</span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={Boolean(parent)}>
            <option value="">None (top level)</option>
            {org.units
              .filter((u) => u.id !== unit?.id)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
      </div>
    </Propose>
  );
}

function UnitDetail({ unit, org, done }: { unit: Unit; org: Org; done: (res?: any) => void }) {
  const [mode, setMode] = useState<'' | 'head' | 'child' | 'edit' | 'delete'>('');
  const members = org.users.filter((u) => u.unitId === unit.id);
  const parent = org.units.find((u) => u.id === unit.parentId);
  const head = org.users.find((u) => u.id === unit.headUserId);
  const acting = org.users.find((u) => u.id === unit.actingHeadUserId);
  const marks = org.findings.filter((f) => f.unitId === unit.id);
  const [kind, setKind] = useState<'head' | 'acting' | 'none'>(head ? 'head' : acting ? 'acting' : 'head');
  const [who, setWho] = useState(unit.headUserId ?? unit.actingHeadUserId ?? '');
  const [until, setUntil] = useState(unit.actingUntil?.slice(0, 10) ?? '');
  const pool = kind === 'head' ? members : org.users;
  return (
    <article className="detail embedded">
      <header className="detail-head">
        <a className="icon-btn detail-close" href="#/org/pohon" aria-label="Close details">
          <X size={18} />
        </a>
        <div className="detail-id">
          <span className="tag">{UNIT_LEVEL_LABEL[unit.level]}</span>
          {parent ? <span className="dim small">under {parent.name}</span> : <span className="dim small">top-level unit</span>}
        </div>
        <h2>{unit.name}</h2>
        <p className="detail-meta">
          {members.length} people · code <span className="num">{unit.id}</span>
        </p>
      </header>
      {marks.length ? (
        <section className="detail-section">
          <ul className="finding-list">
            {marks.map((f, i) => (
              <li key={i} className={f.level === 'error' ? 'bad' : 'warn'}>
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="detail-section">
        <div className="section-head">
          <h3>Unit head</h3>
          {org.canEdit ? (
            <button className="btn small" onClick={() => setMode(mode === 'head' ? '' : 'head')}>
              {mode === 'head' ? 'Cancel' : 'Change'}
            </button>
          ) : null}
        </div>
        {head ? <Person name={head.name} sub={head.title ?? 'Permanent head'} /> : acting ? <Person name={acting.name} sub={`Acting head until ${fmtDate(unit.actingUntil)}`} /> : <p className="dim">Vacant. Approvals for this unit go up to {parent ? `the head of ${parent.name}` : 'no one'}.</p>}
        {mode === 'head' ? (
          <Propose
            label="Propose unit head"
            onDone={done}
            change={() =>
              kind === 'none'
                ? { kind: 'unit_head', id: unit.id, headUserId: null }
                : !who
                  ? 'Select a person first.'
                  : kind === 'head'
                    ? { kind: 'unit_head', id: unit.id, headUserId: who }
                    : { kind: 'unit_head', id: unit.id, actingHeadUserId: who, actingUntil: until ? new Date(`${until}T23:59:59`).toISOString() : null }
            }
          >
            <div className="segmented" role="group" aria-label="Appointment type">
              {(
                [
                  ['head', 'Permanent head'],
                  ['acting', 'Acting head'],
                  ['none', 'Leave vacant'],
                ] as const
              ).map(([k, label]) => (
                <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} aria-pressed={kind === k}>
                  {label}
                </button>
              ))}
            </div>
            {kind !== 'none' ? (
              <label className="field">
                <span className="field-label">{kind === 'head' ? 'Chosen from this unit\'s members' : 'Can be from any unit'}</span>
                <select value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">Select a person</option>
                  {pool.map((u) => (
                    <option key={u.id} value={u.id}>
                      {short(u.name)}
                      {u.title ? `, ${u.title}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {kind === 'acting' ? (
              <label className="field">
                <span className="field-label">Acting head until</span>
                <input type="date" value={until} min={today()} onChange={(e) => setUntil(e.target.value)} required />
              </label>
            ) : null}
          </Propose>
        ) : null}
      </section>
      <section className="detail-section">
        <h3 className="section-title">Members</h3>
        {members.length === 0 ? <p className="dim small">No members yet.</p> : null}
        <ul className="people">
          {members.map((m) => (
            <li key={m.id}>
              <a href={`#/org/pohon/${m.id}`}>
                <Person name={m.name} sub={m.title} />
              </a>
            </li>
          ))}
        </ul>
      </section>
      {org.canEdit ? (
        <section className="detail-section">
          <div className="detail-actions">
            <button className="btn small" onClick={() => setMode(mode === 'child' ? '' : 'child')}>
              <Plus size={14} /> Add sub-unit
            </button>
            <button className="btn small" onClick={() => setMode(mode === 'edit' ? '' : 'edit')}>
              Edit unit
            </button>
            <button className="btn small danger" onClick={() => setMode(mode === 'delete' ? '' : 'delete')}>
              Delete unit
            </button>
          </div>
          {mode === 'child' ? <UnitForm org={org} done={done} parent={unit} /> : null}
          {mode === 'edit' ? <UnitForm org={org} done={done} unit={unit} /> : null}
          {mode === 'delete' ? (
            <Propose label="Propose deletion" onDone={done} change={() => ({ kind: 'unit_delete', id: unit.id })}>
              <p className="dim small">A unit can only be deleted when it has no members and no sub-units.</p>
            </Propose>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

function PersonDetail({ person, org, done }: { person: OrgUser; org: Org; done: (res?: any) => void }) {
  const [chain] = useLoad<{ chain: { userId: string; name: string; basis: string }[]; stop?: string }>(`/org/chain/${person.id}`, [person.id, org]);
  const [mode, setMode] = useState<'' | 'place' | 'exception'>('');
  const [unitId, setUnitId] = useState(person.unitId ?? '');
  const [title, setTitle] = useState(person.title ?? '');
  const unit = org.units.find((u) => u.id === person.unitId);
  const authorities = org.authorities.filter((a) => (org.holders[a.id] ?? []).some((h) => h.userId === person.id));
  const exceptions = org.exceptions.filter((e) => e.userId === person.id && e.endsAt > new Date().toISOString());
  const marks = org.findings.filter((f) => f.userId === person.id);
  return (
    <article className="detail embedded">
      <header className="detail-head">
        <a className="icon-btn detail-close" href="#/org/pohon" aria-label="Close details">
          <X size={18} />
        </a>
        <h2>{short(person.name)}</h2>
        <p className="detail-meta">
          {person.title ?? 'No title set'} · {unit ? unit.name : 'not placed'} · <span className="num">{person.email}</span>
        </p>
      </header>
      {marks.length ? (
        <section className="detail-section">
          <ul className="finding-list">
            {marks.map((f, i) => (
              <li key={i} className={f.level === 'error' ? 'bad' : 'warn'}>
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section className="detail-section">
        <h3 className="section-title">Reporting line</h3>
        {!chain ? <Loading /> : null}
        <ol className="steps">
          {chain?.chain.map((c, i) => (
            <li key={c.userId} className="step open">
              <span className="step-mark" aria-hidden="true" />
              <div className="step-body">
                <div className="step-line">
                  <strong>{short(c.name)}</strong>
                  <span className="dim small">{i === 0 ? 'direct superior' : `${i + 1} levels up`}</span>
                </div>
                <div className="basis">{c.basis}</div>
              </div>
            </li>
          ))}
        </ol>
        {chain && chain.chain.length === 0 ? <p className="error-note">{chain.stop}</p> : null}
      </section>
      <section className="detail-section">
        <h3 className="section-title">Authority</h3>
        {authorities.length === 0 ? <p className="dim small">Holds no authority.</p> : null}
        <div className="tree-tags">
          {authorities.map((a) => (
            <span key={a.id} className="tag blue">
              {a.name}
            </span>
          ))}
        </div>
      </section>
      {exceptions.length ? (
        <section className="detail-section">
          <h3 className="section-title">Reporting exceptions</h3>
          {exceptions.map((e) => (
            <p key={e.id} className="small">
              Reports to <strong>{short(org.users.find((u) => u.id === e.toUserId)?.name)}</strong>
              {e.flowKey ? ` for flow ${e.flowKey}` : ' for all flows'} until {fmtDate(e.endsAt)}. <span className="dim">{e.reason}</span>
            </p>
          ))}
        </section>
      ) : null}
      {org.canEdit ? (
        <section className="detail-section">
          <div className="detail-actions">
            <button className="btn small" onClick={() => setMode(mode === 'place' ? '' : 'place')}>
              Move or change title
            </button>
            <button className="btn small" onClick={() => setMode(mode === 'exception' ? '' : 'exception')}>
              Add reporting exception
            </button>
          </div>
          {mode === 'place' ? (
            <Propose label="Propose placement" onDone={done} change={() => (unitId ? { kind: 'user_place', userId: person.id, unitId, title } : 'Select a unit first.')}>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Unit</span>
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                    <option value="">Select a unit</option>
                    {org.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Title</span>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} />
                </label>
              </div>
            </Propose>
          ) : null}
          {mode === 'exception' ? <ExceptionForm org={org} done={done} userId={person.id} /> : null}
        </section>
      ) : null}
    </article>
  );
}

/* ---------- Karyawan ---------- */

function People({ org }: TabProps) {
  const [q, setQ] = useState('');
  const [only, setOnly] = useState('');
  const unit = new Map(org.units.map((u) => [u.id, u]));
  const rows = org.users.filter(
    (u) =>
      (!q || `${u.name} ${u.title ?? ''} ${u.email} ${unit.get(u.unitId ?? '')?.name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())) &&
      (only !== 'unplaced' || !unit.has(u.unitId ?? '')) &&
      (only !== 'heads' || org.units.some((x) => x.headUserId === u.id)),
  );
  return (
    <div className="page org-page">
      <div className="toolbar">
        <input className="grow" type="search" placeholder="Search by name, title, email, or unit" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
        <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Filter people">
          <option value="">All people</option>
          <option value="unplaced">Not placed</option>
          <option value="heads">Unit heads</option>
        </select>
      </div>
      {rows.length === 0 ? <Empty title="No matching people" /> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Unit</th>
                <th>Authority</th>
                <th className="col-time">Open tasks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.id} onClick={() => (location.hash = `#/org/pohon/${u.id}`)}>
                  <td>
                    <Person name={u.name} sub={u.title ?? u.email} />
                  </td>
                  <td>
                    {unit.get(u.unitId ?? '') ? (
                      <>
                        <span className="cell-main">{unit.get(u.unitId!)!.name}</span>
                        {org.units.some((x) => x.headUserId === u.id) ? <span className="tag">Head</span> : null}
                      </>
                    ) : (
                      <span className="badge bad">Not placed</span>
                    )}
                  </td>
                  <td>
                    <span className="tree-tags">
                      {org.authorities
                        .filter((a) => (org.holders[a.id] ?? []).some((h) => h.userId === u.id))
                        .map((a) => (
                          <span key={a.id} className="tag blue">
                            {a.name}
                          </span>
                        ))}
                    </span>
                  </td>
                  <td className="col-time num">{org.loads[u.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Matriks wewenang ---------- */

function Authorities({ org, done }: TabProps) {
  const [adding, setAdding] = useState('');
  const [who, setWho] = useState('');
  const [scope, setScope] = useState('');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const user = (uid: string) => org.users.find((u) => u.id === uid);
  const unit = (uid?: string) => org.units.find((u) => u.id === uid);
  const remove = async (authorityId: string, h: Holder) => {
    await api('POST', '/org/changes', { change: { kind: 'holder_remove', authorityId, userId: h.userId, scopeUnitId: h.scopeUnitId ?? null } });
    done();
  };
  return (
    <div className="page org-page">
      <p className="page-sub">
        An authority answers "who may approve this", regardless of the requester's unit. Amount limits are set in each flow's rule tables, not here.
      </p>
      <div className="flow-list">
        {org.authorities.map((a) => {
          const holders = org.holders[a.id] ?? [];
          const marks = org.findings.filter((f) => f.authorityId === a.id);
          return (
            <section key={a.id} className="sheet flow">
              <header className="flow-head">
                <div>
                  <h2>
                    {a.name} <Mark findings={marks} />
                  </h2>
                  <p className="cell-sub">
                    <span className="num">{a.id}</span>
                    {a.description ? ` · ${a.description}` : ''} · {org.usage[a.id]?.length ? `used by flows ${org.usage[a.id]!.join(', ')}` : 'not used by any flow'}
                  </p>
                </div>
                {org.canEdit ? (
                  <button className="btn small" onClick={() => setAdding(adding === a.id ? '' : a.id)}>
                    {adding === a.id ? 'Cancel' : 'Add holder'}
                  </button>
                ) : null}
              </header>
              {marks.map((f, i) => (
                <p key={i} className={`check-row ${f.level === 'error' ? 'bad' : 'warn'}`}>
                  {f.message.replace(`Authority ${a.name}: `, '')}
                </p>
              ))}
              <ul className="versions">
                {holders.map((h) => (
                  <li key={`${h.userId}:${h.scopeUnitId ?? ''}`} className="version static">
                    <Person name={user(h.userId)?.name ?? h.userId} sub={user(h.userId)?.title} />
                    <span className="grow cell-sub">{h.scopeUnitId ? `only for requesters under ${unit(h.scopeUnitId)?.name ?? h.scopeUnitId}` : 'for all requesters'}</span>
                    {org.canEdit ? (
                      <button className="btn small danger" onClick={() => remove(a.id, h)}>
                        Propose removal
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {adding === a.id ? (
                <Propose label="Propose holder" onDone={done} change={() => (who ? { kind: 'holder_add', authorityId: a.id, userId: who, scopeUnitId: scope || null } : 'Select a person first.')}>
                  <div className="form-grid">
                    <label className="field">
                      <span className="field-label">Holder</span>
                      <select value={who} onChange={(e) => setWho(e.target.value)}>
                        <option value="">Select a person</option>
                        {org.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {short(u.name)}
                            {u.title ? `, ${u.title}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">Scope</span>
                      <select value={scope} onChange={(e) => setScope(e.target.value)}>
                        <option value="">All requesters</option>
                        {org.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            Only under {u.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                </Propose>
              ) : null}
            </section>
          );
        })}
        {org.authorities.length === 0 ? <Empty title="No authorities yet" /> : null}
        {org.canEdit ? (
          <section className="sheet flow">
            <h2>New authority</h2>
            <Propose label="Propose authority" onDone={done} change={() => ({ kind: 'authority_upsert', id, name, description })}>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="IT purchase approval" required />
                </label>
                <label className="field">
                  <span className="field-label">Code (lowercase letters, digits, underscores)</span>
                  <input className="num" value={id} onChange={(e) => setId(e.target.value)} pattern="[a-z0-9_]+" placeholder="it_purchase" required />
                </label>
                <label className="field span-2">
                  <span className="field-label">
                    Description <span className="optional">optional</span>
                  </span>
                  <input value={description} onChange={(e) => setDescription(e.target.value)} />
                </label>
              </div>
            </Propose>
          </section>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Pengecualian ---------- */

function ExceptionForm({ org, done, userId }: { org: Org; done: (res?: any) => void; userId?: string }) {
  const [who, setWho] = useState(userId ?? '');
  const [to, setTo] = useState('');
  const [flowKey, setFlowKey] = useState('');
  const [reason, setReason] = useState('');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState('');
  const [flows] = useLoad<{ key: string; name: string }[]>('/flows');
  return (
    <Propose
      label="Propose reporting exception"
      onDone={done}
      change={() =>
        !who || !to || !end
          ? 'Select the person, the substitute superior, and the end date.'
          : { kind: 'exception_add', userId: who, toUserId: to, flowKey: flowKey || null, reason, startsAt: new Date(`${start}T00:00:00`).toISOString(), endsAt: new Date(`${end}T23:59:59`).toISOString() }
      }
    >
      <div className="form-grid">
        {userId ? null : (
          <label className="field">
            <span className="field-label">Person</span>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Select a person</option>
              {org.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {short(u.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Reports to</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Select a substitute superior</option>
            {org.users
              .filter((u) => u.id !== who)
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {short(u.name)}
                  {u.title ? `, ${u.title}` : ''}
                </option>
              ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Applies to</span>
          <select value={flowKey} onChange={(e) => setFlowKey(e.target.value)}>
            <option value="">All flows</option>
            {flows?.map((f) => (
              <option key={f.key} value={f.key}>
                Only {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Starts</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Ends (one year at most)</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label className="field span-2">
          <span className="field-label">Reason</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: seconded to the ERP project" required />
        </label>
      </div>
    </Propose>
  );
}

function Exceptions({ org, done }: TabProps) {
  const now = new Date().toISOString();
  const name = (id: string) => org.users.find((u) => u.id === id)?.name ?? id;
  const end = async (id: string) => {
    await api('POST', '/org/changes', { change: { kind: 'exception_end', id } });
    done();
  };
  const rows = [...org.exceptions].sort((a, b) => b.endsAt.localeCompare(a.endsAt));
  return (
    <div className="page org-page">
      <p className="page-sub">Use a reporting exception when someone reports to a person outside their unit. Each one has a reason and an end date, so it does not become a hidden habit.</p>
      <div className="two-col">
        <section>
          {rows.length === 0 ? <Empty title="No reporting exceptions">Everyone reports according to the unit tree.</Empty> : null}
          {rows.length ? (
            <div className="table-wrap">
              <table className="table static">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Reports to</th>
                    <th>Scope and reason</th>
                    <th>Period</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const state = e.endsAt <= now ? 'Ended' : e.startsAt > now ? 'Scheduled' : 'Active';
                    return (
                      <tr key={e.id}>
                        <td>
                          <Person name={name(e.userId)} />
                        </td>
                        <td>
                          <Person name={name(e.toUserId)} />
                        </td>
                        <td>
                          <div className="cell-main">{e.flowKey ? `Flow ${e.flowKey}` : 'All flows'}</div>
                          <div className="cell-sub">{e.reason}</div>
                        </td>
                        <td>
                          <div className="num">
                            {fmtDate(e.startsAt)} – {fmtDate(e.endsAt)}
                          </div>
                          <Badge status={state === 'Active' ? 'active' : state === 'Scheduled' ? 'open' : 'cancelled'} label={state} />
                        </td>
                        <td className="col-action">
                          {org.canEdit && state !== 'Ended' ? (
                            <button className="btn small danger" onClick={() => end(e.id)}>
                              Propose ending
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
        {org.canEdit ? (
          <div className="sheet">
            <h2>New reporting exception</h2>
            <ExceptionForm org={org} done={done} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Perubahan ---------- */

const CHANGE_STATUS: Record<string, [string, string]> = {
  pending: ['open', 'Awaiting review'],
  scheduled: ['draft', 'Scheduled'],
  applied: ['approved', 'In effect'],
  rejected: ['rejected', 'Rejected'],
  failed: ['rejected', 'Could not be applied'],
};

function Changes({ onDone }: { onDone: () => void }) {
  const [list, reload, error] = useLoad<any[]>('/org/changes');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const review = async (id: string, decision: 'approve' | 'reject') => {
    setMessage('');
    try {
      const res = await api('POST', `/org/changes/${id}/review`, { decision, note: notes[id] });
      setMessage(
        res.status === 'applied'
          ? `Change applied.${res.movedTasks ? ` ${res.movedTasks} open ${res.movedTasks === 1 ? 'task was' : 'tasks were'} reassigned to match the new structure.` : ''}`
          : res.status === 'scheduled'
            ? `Approved. Takes effect ${fmtDate(res.effectiveFrom)}.`
            : 'Proposal rejected.',
      );
    } catch (e: any) {
      setMessage(e.message);
    }
    reload();
    onDone();
  };
  return (
    <div className="page org-page">
      <ErrorNote>{error}</ErrorNote>
      {message ? <div className="notice">{message}</div> : null}
      {!list && !error ? <Loading /> : null}
      {list?.length === 0 ? <Empty title="No change proposals yet" /> : null}
      <div className="flow-list">
        {list?.map((ch) => {
          const [tone, label] = CHANGE_STATUS[ch.status] ?? ['open', ch.status];
          return (
            <section key={ch.id} className="sheet change">
              <div className="flow-head">
                <div>
                  <p className="cell-main">{ch.summary}</p>
                  <p className="cell-sub">
                    Proposed by {short(ch.proposed_by_name)} · <span className="num">{fmtTime(ch.proposed_at)}</span> · effective <span className="num">{fmtDate(ch.effective_from)}</span>
                    {ch.reviewed_by_name ? ` · reviewed by ${short(ch.reviewed_by_name)}` : ''}
                  </p>
                </div>
                <Badge status={tone} label={label} />
              </div>
              {ch.note ? <blockquote>{ch.note}</blockquote> : null}
              {ch.review_note ? <p className="dim small">Reviewer note: {ch.review_note}</p> : null}
              {ch.impact.length ? (
                <ul className="finding-list">
                  {ch.impact.map((i: any, n: number) => (
                    <li key={n} className={i.type === 'selesai' ? 'ok' : i.level === 'error' ? 'bad' : 'warn'}>
                      {i.type === 'selesai' ? 'Resolves: ' : 'Introduces: '}
                      {i.message}
                    </li>
                  ))}
                </ul>
              ) : ch.status === 'pending' ? (
                <p className="dim small">Introduces no new structure findings.</p>
              ) : null}
              {ch.status === 'pending' ? (
                ch.canReview ? (
                  <div className="toolbar review">
                    <input className="grow" placeholder="Review note (optional)" value={notes[ch.id] ?? ''} onChange={(e) => setNotes({ ...notes, [ch.id]: e.target.value })} />
                    <button className="btn danger" onClick={() => review(ch.id, 'reject')}>
                      Reject
                    </button>
                    <button className="btn primary" onClick={() => review(ch.id, 'approve')}>
                      Approve
                    </button>
                  </div>
                ) : (
                  <p className="dim small">This is your own proposal, or you are not an organization owner: another organization owner must review it.</p>
                )
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Uji cakupan ---------- */

function Coverage() {
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setRes(await api('GET', '/org/coverage'));
    } catch (e: any) {
      setError(e.message);
    }
    setBusy(false);
  };
  useEffect(() => {
    run();
  }, []);
  return (
    <div className="page org-page">
      <div className="page-head">
        <p className="page-sub">Every person is tested as a requester in every active flow, including every rule table row. The paths listed here would dead-end if the request were submitted today.</p>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? 'Testing…' : 'Run again'}
        </button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!res && !error ? <Loading label="Testing every person in every flow…" /> : null}
      <div className="flow-list">
        {res?.flows.map((f: any) => (
          <section key={f.key} className="sheet flow">
            <header className="flow-head">
              <div>
                <h2>{f.name}</h2>
                <p className="cell-sub">
                  version {f.version} · <span className="num">{f.people - f.blocked}</span> of <span className="num">{f.people}</span> people have a complete path
                </p>
              </div>
              <Badge status={f.blocked ? 'rejected' : 'approved'} label={f.blocked ? `${f.blocked} blocked` : 'Everyone has a path'} />
            </header>
            {f.gaps.length ? (
              <div className="table-wrap">
                <table className="table static">
                  <thead>
                    <tr>
                      <th>Requester</th>
                      <th>Step</th>
                      <th>Why it dead-ends</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.gaps.map((g: any, i: number) => (
                      <tr key={i}>
                        <td>
                          <a href={`#/org/pohon/${g.userId}`}>{short(res.names[g.userId])}</a>
                        </td>
                        <td>
                          <span className="cell-main">{g.stepName}</span>
                          {g.tableRow ? <div className="cell-sub num">{g.tableRow.tableId} · {g.tableRow.rowId}</div> : null}
                        </td>
                        <td>{g.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ))}
        {res?.flows.length === 0 ? <Empty title="No active flows yet" /> : null}
      </div>
    </div>
  );
}

/* ---------- Pengaturan (admin sistem) ---------- */

function Settings({ org, onDone }: { org: Org; onDone: () => void }) {
  const [picked, setPicked] = useState<string[]>(org.owners.map((o) => o.user_id));
  const [units, setUnits] = useState('');
  const [people, setPeople] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<string>) => {
    setError('');
    setMessage('');
    try {
      setMessage(await fn());
      onDone();
    } catch (e: any) {
      setError(e.message);
    }
  };
  const toggle = (id: string) => setPicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="page org-page">
      {message ? <div className="notice ok">{message}</div> : null}
      <ErrorNote>{error}</ErrorNote>
      <div className="flow-list">
        <section className="sheet flow">
          <h2>Organization owners</h2>
          <p className="cell-sub">At least two people, so that every proposed change is reviewed by a second person.</p>
          <div className="owner-grid">
            {org.users.map((u) => (
              <label key={u.id} className="check">
                <input type="checkbox" checked={picked.includes(u.id)} onChange={() => toggle(u.id)} />
                <span>
                  {short(u.name)} <span className="dim">{u.title}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button className="btn primary" disabled={picked.length < 2} onClick={() => run(async () => (await api('PUT', '/org/owners', { userIds: picked }), 'Organization owners saved.'))}>
              Save owners
            </button>
          </div>
        </section>
        <section className="sheet flow">
          <h2>Import units</h2>
          <p className="cell-sub">
            CSV with columns <span className="num">id,name,level,parent_id</span>. Levels: {UNIT_LEVELS.join(', ')}. Unit heads are not imported; they are set through a proposal on the Tree tab.
          </p>
          <textarea rows={5} className="num" value={units} onChange={(e) => setUnits(e.target.value)} placeholder={'id,name,level,parent_id\nfinance,Finance,departemen,direksi'} />
          <div className="form-actions">
            <button className="btn primary" disabled={!units.trim()} onClick={() => run(async () => `${(await api('POST', '/org/import/units', units)).imported} units imported.`)}>
              Import units
            </button>
          </div>
        </section>
        <section className="sheet flow">
          <h2>Import people</h2>
          <p className="cell-sub">
            CSV with columns <span className="num">id,email,name,unit_id,title</span>. Superiors are not imported: they are derived from the unit. New people get a temporary password.
          </p>
          <textarea rows={5} className="num" value={people} onChange={(e) => setPeople(e.target.value)} placeholder={'id,email,name,unit_id,title\nu_rina,rina@example.test,Rina,finance,Accounting staff'} />
          <div className="form-actions">
            <button
              className="btn primary"
              disabled={!people.trim()}
              onClick={() =>
                run(async () => {
                  const res = await api('POST', '/admin/directory', people);
                  return `${res.imported} people imported.${res.created.length ? ` Temporary passwords: ${res.created.map((c: any) => `${c.email} ${c.temporaryPassword}`).join('; ')}` : ''}`;
                })
              }
            >
              Import people
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
