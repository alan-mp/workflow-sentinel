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
  ['pohon', 'Pohon'],
  ['karyawan', 'Karyawan'],
  ['wewenang', 'Matriks wewenang'],
  ['pengecualian', 'Pengecualian'],
  ['perubahan', 'Perubahan'],
  ['cakupan', 'Uji cakupan'],
];
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
const short = (name?: string) => (name ? splitName(name)[0] : '-');

/** Formulir usulan: setiap perubahan butuh catatan opsional dan tanggal berlaku, lalu menunggu tinjauan orang kedua. */
function Propose(props: { change: () => object | string; label: string; onDone: () => void; disabled?: boolean; children?: ReactNode }) {
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
      await api('POST', '/org/changes', { change, note, effectiveFrom: date > today() ? new Date(`${date}T00:00:00`).toISOString() : undefined });
      setNote('');
      props.onDone();
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
          <span className="field-label">Berlaku mulai</span>
          <input type="date" value={date} min={today()} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">
            Catatan untuk peninjau <span className="optional">opsional</span>
          </span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      <ErrorNote>{error}</ErrorNote>
      <div className="form-actions">
        <button className="btn primary" disabled={busy || props.disabled}>
          {busy ? 'Mengirim…' : props.label}
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
  const [sent, setSent] = useState(false);
  if (error) return <div className="page"><ErrorNote>{error}</ErrorNote></div>;
  if (!org) return <Loading />;
  const done = () => {
    setSent(true);
    reload();
  };
  const errors = org.findings.filter((f) => f.level === 'error').length;
  const warnings = org.findings.length - errors;
  const props = { org, done, selected };
  return (
    <div className="org">
      <div className="org-head">
        <PageHead
          title="Organisasi"
          sub={
            org.canEdit
              ? 'Atasan dihitung dari pohon unit, wewenang dari matriks. Setiap perubahan Anda usulkan, lalu ditinjau pemilik organisasi lain sebelum berlaku.'
              : org.isAdmin
                ? 'Anda admin sistem: menunjuk pemilik master organisasi dan mengimpor isi awal. Perubahan struktur dilakukan pemiliknya.'
                : 'Struktur dan wewenang yang dipakai alur approval. Hanya pemilik master organisasi yang bisa mengubahnya.'
          }
        />
        <div className="gauge" role="group" aria-label="Kesehatan struktur">
          <a className="gauge-seg out" href="#/org/pohon">
            <span className="gauge-n">{errors}</span> Routing bisa buntu
          </a>
          <a className="gauge-seg near" href="#/org/pohon">
            <span className="gauge-n">{warnings}</span> Perlu perhatian
          </a>
          <a className="gauge-seg" href="#/org/perubahan">
            <span className="gauge-n">{org.pending}</span> Usulan menunggu
          </a>
          <span className="gauge-seg static">
            <span className="gauge-n">{org.users.length}</span> orang di {org.units.length} unit
          </span>
        </div>
        {sent ? (
          <div className="notice ok" role="status">
            Usulan terkirim. Perubahan baru berlaku setelah disetujui pemilik organisasi lain.{' '}
            <a href="#/org/perubahan">Lihat usulan</a>
            <button className="icon-btn" onClick={() => setSent(false)} aria-label="Tutup">
              <X size={16} />
            </button>
          </div>
        ) : null}
        <nav className="side-tabs org-tabs" aria-label="Bagian organisasi">
          {[...TABS, ...(org.isAdmin ? [['pengaturan', 'Pengaturan'] as [string, string]] : [])].map(([key, label]) => (
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

type TabProps = { org: Org; done: () => void; selected?: string };

/* ---------- Pohon ---------- */

function Tree({ org, done, selected }: TabProps) {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const users = useMemo(() => new Map(org.users.map((u) => [u.id, u])), [org]);
  const children = (parentId?: string) => org.units.filter((u) => (u.parentId ?? undefined) === parentId).sort((a, b) => a.name.localeCompare(b.name, 'id'));
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
          <button className="icon-btn tree-toggle" onClick={toggle} aria-label={open ? `Tutup ${unit.name}` : `Buka ${unit.name}`} aria-expanded={open} disabled={kids.length + people.length === 0}>
            {kids.length + people.length === 0 ? null : open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
          <a className="tree-main" href={`#/org/pohon/${unit.id}`}>
            <span className="cell-main">{unit.name}</span>
            <span className="tag">{UNIT_LEVEL_LABEL[unit.level]}</span>
            <Mark findings={marks} />
          </a>
          <span className="tree-head">
            {head ? <Person name={head.name} sub={head.title ?? 'Kepala'} compact={false} /> : acting ? <Person name={acting.name} sub={`Plt sampai ${fmtDate(unit.actingUntil)}`} /> : <span className="badge bad">Kepala kosong</span>}
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
                      {activeException(m.id) ? <span className="tag warn">Pengecualian</span> : null}
                    </span>
                    {org.loads[m.id] ? <span className="tree-count num" title="Tugas terbuka">{org.loads[m.id]}</span> : <span className="tree-count" />}
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
      <section className="split-list" aria-label="Pohon organisasi">
        <div className="toolbar">
          <input className="grow" type="search" placeholder="Cari unit, nama, atau jabatan" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari di pohon" />
          <button className="btn" onClick={() => setClosed(closed.size ? new Set() : new Set(org.units.map((u) => u.id)))}>
            {closed.size ? 'Buka semua' : 'Tutup semua'}
          </button>
        </div>
        {org.units.length === 0 ? (
          <Empty title="Belum ada unit organisasi">Admin sistem mengimpor daftar unit di tab Pengaturan, atau pemilik organisasi menambah unit puncak di panel kanan.</Empty>
        ) : (
          <div className="tree" role="tree">
            <div className="tree-cols">
              <span>Unit dan anggota</span>
              <span>Kepala</span>
              <span>Orang</span>
            </div>
            <ul className="tree-list">{children(undefined).map((u) => row(u, 0))}</ul>
          </div>
        )}
        {unplaced.length ? (
          <div className="tree unplaced">
            <div className="tree-cols">
              <span>Belum ditempatkan di unit ({unplaced.length})</span>
            </div>
            <ul className="tree-list">
              {unplaced
                .filter((m) => hit(m.name))
                .map((m) => (
                  <li key={m.id}>
                    <a className={`tree-row person-row ${selected === m.id ? 'selected' : ''}`} href={`#/org/pohon/${m.id}`}>
                      <Person name={m.name} sub={m.title} />
                      <span className="badge bad">Tanpa jalur approval</span>
                    </a>
                  </li>
                ))}
            </ul>
          </div>
        ) : null}
      </section>
      <section className={`split-detail ${unit || person ? '' : 'placeholder'}`} aria-label="Detail">
        {unit ? <UnitDetail key={unit.id} unit={unit} org={org} done={done} /> : person ? <PersonDetail key={person.id} person={person} org={org} done={done} /> : <RootPanel org={org} done={done} />}
      </section>
    </div>
  );
}

function RootPanel({ org, done }: { org: Org; done: () => void }) {
  const general = org.findings.filter((f) => !f.unitId && !f.userId);
  return (
    <div className="org-root">
      <p>Pilih unit atau orang untuk melihat detail{org.canEdit ? ' dan mengusulkan perubahan' : ''}.</p>
      {general.length ? <h3>Temuan wewenang</h3> : null}
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

function UnitForm({ org, done, parent, unit }: { org: Org; done: () => void; parent?: Unit; unit?: Unit }) {
  const [name, setName] = useState(unit?.name ?? '');
  const below = parent ? UNIT_LEVELS.slice(UNIT_LEVELS.indexOf(parent.level) + 1) : [...UNIT_LEVELS];
  const [level, setLevel] = useState<UnitLevel>(unit?.level ?? below[0] ?? 'seksi');
  const [parentId, setParentId] = useState(unit ? (unit.parentId ?? '') : (parent?.id ?? ''));
  return (
    <Propose label={unit ? 'Usulkan perubahan unit' : 'Usulkan unit baru'} onDone={done} change={() => ({ kind: 'unit_upsert', id: unit?.id, name, level, parentId: parentId || null })}>
      <label className="field">
        <span className="field-label">Nama unit</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <div className="form-grid">
        <label className="field">
          <span className="field-label">Tingkat</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as UnitLevel)}>
            {(unit ? UNIT_LEVELS : below).map((l) => (
              <option key={l} value={l}>
                {UNIT_LEVEL_LABEL[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Unit induk</span>
          <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={Boolean(parent)}>
            <option value="">Tidak ada (puncak)</option>
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

function UnitDetail({ unit, org, done }: { unit: Unit; org: Org; done: () => void }) {
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
        <a className="icon-btn detail-close" href="#/org/pohon" aria-label="Tutup detail">
          <X size={18} />
        </a>
        <div className="detail-id">
          <span className="tag">{UNIT_LEVEL_LABEL[unit.level]}</span>
          {parent ? <span className="dim small">di bawah {parent.name}</span> : <span className="dim small">unit puncak</span>}
        </div>
        <h2>{unit.name}</h2>
        <p className="detail-meta">
          {members.length} orang · kode <span className="num">{unit.id}</span>
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
          <h3>Kepala unit</h3>
          {org.canEdit ? (
            <button className="btn small" onClick={() => setMode(mode === 'head' ? '' : 'head')}>
              {mode === 'head' ? 'Batal' : 'Ganti'}
            </button>
          ) : null}
        </div>
        {head ? <Person name={head.name} sub={head.title ?? 'Kepala definitif'} /> : acting ? <Person name={acting.name} sub={`Plt sampai ${fmtDate(unit.actingUntil)}`} /> : <p className="dim">Kosong. Approval untuk unit ini naik ke {parent ? `kepala ${parent.name}` : 'tidak ada siapa pun'}.</p>}
        {mode === 'head' ? (
          <Propose
            label="Usulkan kepala unit"
            onDone={done}
            change={() =>
              kind === 'none'
                ? { kind: 'unit_head', id: unit.id, headUserId: null }
                : !who
                  ? 'Pilih orangnya dulu'
                  : kind === 'head'
                    ? { kind: 'unit_head', id: unit.id, headUserId: who }
                    : { kind: 'unit_head', id: unit.id, actingHeadUserId: who, actingUntil: until ? new Date(`${until}T23:59:59`).toISOString() : null }
            }
          >
            <div className="segmented" role="group" aria-label="Jenis penunjukan">
              {(
                [
                  ['head', 'Kepala definitif'],
                  ['acting', 'Pejabat sementara (Plt)'],
                  ['none', 'Kosongkan'],
                ] as const
              ).map(([k, label]) => (
                <button type="button" key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)} aria-pressed={kind === k}>
                  {label}
                </button>
              ))}
            </div>
            {kind !== 'none' ? (
              <label className="field">
                <span className="field-label">{kind === 'head' ? 'Dipilih dari anggota unit ini' : 'Boleh dari unit mana pun'}</span>
                <select value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">Pilih orang</option>
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
                <span className="field-label">Plt berakhir</span>
                <input type="date" value={until} min={today()} onChange={(e) => setUntil(e.target.value)} required />
              </label>
            ) : null}
          </Propose>
        ) : null}
      </section>
      <section className="detail-section">
        <h3 className="section-title">Anggota</h3>
        {members.length === 0 ? <p className="dim small">Belum ada anggota.</p> : null}
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
              <Plus size={14} /> Unit di bawahnya
            </button>
            <button className="btn small" onClick={() => setMode(mode === 'edit' ? '' : 'edit')}>
              Ubah unit
            </button>
            <button className="btn small danger" onClick={() => setMode(mode === 'delete' ? '' : 'delete')}>
              Hapus unit
            </button>
          </div>
          {mode === 'child' ? <UnitForm org={org} done={done} parent={unit} /> : null}
          {mode === 'edit' ? <UnitForm org={org} done={done} unit={unit} /> : null}
          {mode === 'delete' ? (
            <Propose label="Usulkan penghapusan" onDone={done} change={() => ({ kind: 'unit_delete', id: unit.id })}>
              <p className="dim small">Unit hanya bisa dihapus kalau tidak punya anggota dan tidak punya unit di bawahnya.</p>
            </Propose>
          ) : null}
        </section>
      ) : null}
    </article>
  );
}

function PersonDetail({ person, org, done }: { person: OrgUser; org: Org; done: () => void }) {
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
        <a className="icon-btn detail-close" href="#/org/pohon" aria-label="Tutup detail">
          <X size={18} />
        </a>
        <h2>{short(person.name)}</h2>
        <p className="detail-meta">
          {person.title ?? 'Jabatan belum diisi'} · {unit ? unit.name : 'belum ditempatkan'} · <span className="num">{person.email}</span>
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
        <h3 className="section-title">Jalur atasan</h3>
        {!chain ? <Loading /> : null}
        <ol className="steps">
          {chain?.chain.map((c, i) => (
            <li key={c.userId} className="step open">
              <span className="step-mark" aria-hidden="true" />
              <div className="step-body">
                <div className="step-line">
                  <strong>{short(c.name)}</strong>
                  <span className="dim small">{i === 0 ? 'atasan langsung' : `${i + 1} tingkat di atas`}</span>
                </div>
                <div className="basis">{c.basis}</div>
              </div>
            </li>
          ))}
        </ol>
        {chain && chain.chain.length === 0 ? <p className="error-note">{chain.stop}</p> : null}
      </section>
      <section className="detail-section">
        <h3 className="section-title">Wewenang</h3>
        {authorities.length === 0 ? <p className="dim small">Tidak memegang wewenang.</p> : null}
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
          <h3 className="section-title">Pengecualian pelaporan</h3>
          {exceptions.map((e) => (
            <p key={e.id} className="small">
              Melapor ke <strong>{short(org.users.find((u) => u.id === e.toUserId)?.name)}</strong>
              {e.flowKey ? ` untuk alur ${e.flowKey}` : ' untuk semua alur'} sampai {fmtDate(e.endsAt)}. <span className="dim">{e.reason}</span>
            </p>
          ))}
        </section>
      ) : null}
      {org.canEdit ? (
        <section className="detail-section">
          <div className="detail-actions">
            <button className="btn small" onClick={() => setMode(mode === 'place' ? '' : 'place')}>
              Pindahkan atau ubah jabatan
            </button>
            <button className="btn small" onClick={() => setMode(mode === 'exception' ? '' : 'exception')}>
              Tambah pengecualian
            </button>
          </div>
          {mode === 'place' ? (
            <Propose label="Usulkan penempatan" onDone={done} change={() => (unitId ? { kind: 'user_place', userId: person.id, unitId, title } : 'Pilih unitnya dulu')}>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Unit</span>
                  <select value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                    <option value="">Pilih unit</option>
                    {org.units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span className="field-label">Jabatan</span>
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
        <input className="grow" type="search" placeholder="Cari nama, jabatan, email, atau unit" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari karyawan" />
        <select value={only} onChange={(e) => setOnly(e.target.value)} aria-label="Saring karyawan">
          <option value="">Semua karyawan</option>
          <option value="unplaced">Belum ditempatkan</option>
          <option value="heads">Kepala unit</option>
        </select>
      </div>
      {rows.length === 0 ? <Empty title="Tidak ada karyawan yang cocok" /> : null}
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Nama</th>
                <th>Unit</th>
                <th>Wewenang</th>
                <th className="col-time">Tugas terbuka</th>
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
                        {org.units.some((x) => x.headUserId === u.id) ? <span className="tag">Kepala</span> : null}
                      </>
                    ) : (
                      <span className="badge bad">Belum ditempatkan</span>
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
        Wewenang menjawab "siapa berhak menyetujui hal ini", terlepas dari unit pemohon. Batas nominal diatur di tabel aturan tiap alur, bukan di sini.
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
                    {a.description ? ` · ${a.description}` : ''} · {org.usage[a.id]?.length ? `dipakai alur ${org.usage[a.id]!.join(', ')}` : 'belum dipakai alur mana pun'}
                  </p>
                </div>
                {org.canEdit ? (
                  <button className="btn small" onClick={() => setAdding(adding === a.id ? '' : a.id)}>
                    {adding === a.id ? 'Batal' : 'Tambah pemegang'}
                  </button>
                ) : null}
              </header>
              {marks.map((f, i) => (
                <p key={i} className={`check-row ${f.level === 'error' ? 'bad' : 'warn'}`}>
                  {f.message.replace(`Wewenang ${a.name}: `, '')}
                </p>
              ))}
              <ul className="versions">
                {holders.map((h) => (
                  <li key={`${h.userId}:${h.scopeUnitId ?? ''}`} className="version static">
                    <Person name={user(h.userId)?.name ?? h.userId} sub={user(h.userId)?.title} />
                    <span className="grow cell-sub">{h.scopeUnitId ? `hanya untuk pemohon di bawah ${unit(h.scopeUnitId)?.name ?? h.scopeUnitId}` : 'untuk semua pemohon'}</span>
                    {org.canEdit ? (
                      <button className="btn small danger" onClick={() => remove(a.id, h)}>
                        Usulkan cabut
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {adding === a.id ? (
                <Propose label="Usulkan pemegang" onDone={done} change={() => (who ? { kind: 'holder_add', authorityId: a.id, userId: who, scopeUnitId: scope || null } : 'Pilih orangnya dulu')}>
                  <div className="form-grid">
                    <label className="field">
                      <span className="field-label">Pemegang</span>
                      <select value={who} onChange={(e) => setWho(e.target.value)}>
                        <option value="">Pilih orang</option>
                        {org.users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {short(u.name)}
                            {u.title ? `, ${u.title}` : ''}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span className="field-label">Cakupan</span>
                      <select value={scope} onChange={(e) => setScope(e.target.value)}>
                        <option value="">Semua pemohon</option>
                        {org.units.map((u) => (
                          <option key={u.id} value={u.id}>
                            Hanya di bawah {u.name}
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
        {org.authorities.length === 0 ? <Empty title="Belum ada wewenang" /> : null}
        {org.canEdit ? (
          <section className="sheet flow">
            <h2>Wewenang baru</h2>
            <Propose label="Usulkan wewenang" onDone={done} change={() => ({ kind: 'authority_upsert', id, name, description })}>
              <div className="form-grid">
                <label className="field">
                  <span className="field-label">Nama</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Persetujuan pembelian IT" required />
                </label>
                <label className="field">
                  <span className="field-label">Kode (huruf kecil, angka, garis bawah)</span>
                  <input className="num" value={id} onChange={(e) => setId(e.target.value)} pattern="[a-z0-9_]+" placeholder="pembelian_it" required />
                </label>
                <label className="field span-2">
                  <span className="field-label">
                    Keterangan <span className="optional">opsional</span>
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

function ExceptionForm({ org, done, userId }: { org: Org; done: () => void; userId?: string }) {
  const [who, setWho] = useState(userId ?? '');
  const [to, setTo] = useState('');
  const [flowKey, setFlowKey] = useState('');
  const [reason, setReason] = useState('');
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState('');
  const [flows] = useLoad<{ key: string; name: string }[]>('/flows');
  return (
    <Propose
      label="Usulkan pengecualian"
      onDone={done}
      change={() =>
        !who || !to || !end
          ? 'Lengkapi orang, atasan pengganti, dan tanggal berakhir'
          : { kind: 'exception_add', userId: who, toUserId: to, flowKey: flowKey || null, reason, startsAt: new Date(`${start}T00:00:00`).toISOString(), endsAt: new Date(`${end}T23:59:59`).toISOString() }
      }
    >
      <div className="form-grid">
        {userId ? null : (
          <label className="field">
            <span className="field-label">Siapa</span>
            <select value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Pilih orang</option>
              {org.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {short(u.name)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="field">
          <span className="field-label">Melapor ke</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Pilih atasan pengganti</option>
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
          <span className="field-label">Berlaku untuk</span>
          <select value={flowKey} onChange={(e) => setFlowKey(e.target.value)}>
            <option value="">Semua alur</option>
            {flows?.map((f) => (
              <option key={f.key} value={f.key}>
                Hanya {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Mulai</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label className="field">
          <span className="field-label">Berakhir (paling lama satu tahun)</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <label className="field span-2">
          <span className="field-label">Alasan</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Misalnya: diperbantukan ke proyek ERP" required />
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
      <p className="page-sub">Pengecualian dipakai kalau seseorang memang melapor ke orang di luar unitnya. Selalu punya alasan dan tanggal berakhir, supaya tidak menjadi kebiasaan tersembunyi.</p>
      <div className="two-col">
        <section>
          {rows.length === 0 ? <Empty title="Tidak ada pengecualian pelaporan">Semua orang melapor sesuai pohon unit.</Empty> : null}
          {rows.length ? (
            <div className="table-wrap">
              <table className="table static">
                <thead>
                  <tr>
                    <th>Siapa</th>
                    <th>Melapor ke</th>
                    <th>Cakupan dan alasan</th>
                    <th>Periode</th>
                    <th aria-label="Aksi" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const state = e.endsAt <= now ? 'Berakhir' : e.startsAt > now ? 'Terjadwal' : 'Aktif';
                    return (
                      <tr key={e.id}>
                        <td>
                          <Person name={name(e.userId)} />
                        </td>
                        <td>
                          <Person name={name(e.toUserId)} />
                        </td>
                        <td>
                          <div className="cell-main">{e.flowKey ? `Alur ${e.flowKey}` : 'Semua alur'}</div>
                          <div className="cell-sub">{e.reason}</div>
                        </td>
                        <td>
                          <div className="num">
                            {fmtDate(e.startsAt)} – {fmtDate(e.endsAt)}
                          </div>
                          <Badge status={state === 'Aktif' ? 'active' : state === 'Terjadwal' ? 'open' : 'cancelled'} label={state} />
                        </td>
                        <td className="col-action">
                          {org.canEdit && state !== 'Berakhir' ? (
                            <button className="btn small danger" onClick={() => end(e.id)}>
                              Usulkan akhiri
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
            <h2>Pengecualian baru</h2>
            <ExceptionForm org={org} done={done} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- Perubahan ---------- */

const CHANGE_STATUS: Record<string, [string, string]> = {
  pending: ['open', 'Menunggu tinjauan'],
  scheduled: ['draft', 'Terjadwal'],
  applied: ['approved', 'Berlaku'],
  rejected: ['rejected', 'Ditolak'],
  failed: ['rejected', 'Gagal diterapkan'],
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
          ? `Perubahan berlaku.${res.movedTasks ? ` ${res.movedTasks} tugas terbuka dialihkan mengikuti struktur baru.` : ''}`
          : res.status === 'scheduled'
            ? `Disetujui, berlaku ${fmtDate(res.effectiveFrom)}.`
            : 'Usulan ditolak.',
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
      {list?.length === 0 ? <Empty title="Belum ada usulan perubahan" /> : null}
      <div className="flow-list">
        {list?.map((ch) => {
          const [tone, label] = CHANGE_STATUS[ch.status] ?? ['open', ch.status];
          return (
            <section key={ch.id} className="sheet change">
              <div className="flow-head">
                <div>
                  <p className="cell-main">{ch.summary}</p>
                  <p className="cell-sub">
                    Diusulkan {short(ch.proposed_by_name)} · <span className="num">{fmtTime(ch.proposed_at)}</span> · berlaku <span className="num">{fmtDate(ch.effective_from)}</span>
                    {ch.reviewed_by_name ? ` · ditinjau ${short(ch.reviewed_by_name)}` : ''}
                  </p>
                </div>
                <Badge status={tone} label={label} />
              </div>
              {ch.note ? <blockquote>{ch.note}</blockquote> : null}
              {ch.review_note ? <p className="dim small">Catatan peninjau: {ch.review_note}</p> : null}
              {ch.impact.length ? (
                <ul className="finding-list">
                  {ch.impact.map((i: any, n: number) => (
                    <li key={n} className={i.type === 'selesai' ? 'ok' : i.level === 'error' ? 'bad' : 'warn'}>
                      {i.type === 'selesai' ? 'Menyelesaikan: ' : 'Menimbulkan: '}
                      {i.message}
                    </li>
                  ))}
                </ul>
              ) : ch.status === 'pending' ? (
                <p className="dim small">Tidak menimbulkan temuan struktur baru.</p>
              ) : null}
              {ch.status === 'pending' ? (
                ch.canReview ? (
                  <div className="toolbar review">
                    <input className="grow" placeholder="Catatan tinjauan (opsional)" value={notes[ch.id] ?? ''} onChange={(e) => setNotes({ ...notes, [ch.id]: e.target.value })} />
                    <button className="btn danger" onClick={() => review(ch.id, 'reject')}>
                      Tolak
                    </button>
                    <button className="btn primary" onClick={() => review(ch.id, 'approve')}>
                      Setujui
                    </button>
                  </div>
                ) : (
                  <p className="dim small">Usulan Anda sendiri, atau Anda bukan pemilik organisasi: harus ditinjau pemilik organisasi lain.</p>
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
        <p className="page-sub">Setiap orang dicoba sebagai pemohon di setiap alur yang berlaku, termasuk semua baris tabel aturan. Yang tampil di sini adalah jalur yang akan buntu kalau permintaannya diajukan hari ini.</p>
        <button className="btn" onClick={run} disabled={busy}>
          {busy ? 'Menguji…' : 'Uji ulang'}
        </button>
      </div>
      <ErrorNote>{error}</ErrorNote>
      {!res && !error ? <Loading label="Menguji semua orang di semua alur…" /> : null}
      <div className="flow-list">
        {res?.flows.map((f: any) => (
          <section key={f.key} className="sheet flow">
            <header className="flow-head">
              <div>
                <h2>{f.name}</h2>
                <p className="cell-sub">
                  versi {f.version} · <span className="num">{f.people - f.blocked}</span> dari <span className="num">{f.people}</span> orang punya jalur lengkap
                </p>
              </div>
              <Badge status={f.blocked ? 'rejected' : 'approved'} label={f.blocked ? `${f.blocked} orang buntu` : 'Semua punya jalur'} />
            </header>
            {f.gaps.length ? (
              <div className="table-wrap">
                <table className="table static">
                  <thead>
                    <tr>
                      <th>Pemohon</th>
                      <th>Langkah</th>
                      <th>Kenapa buntu</th>
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
        {res?.flows.length === 0 ? <Empty title="Belum ada alur yang berlaku" /> : null}
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
          <h2>Pemilik master organisasi</h2>
          <p className="cell-sub">Minimal dua orang, supaya setiap perubahan ditinjau orang kedua. Admin sistem tidak bisa menjadi pemilik.</p>
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
            <button className="btn primary" disabled={picked.length < 2} onClick={() => run(async () => (await api('PUT', '/org/owners', { userIds: picked }), 'Pemilik master organisasi tersimpan.'))}>
              Simpan pemilik
            </button>
          </div>
        </section>
        <section className="sheet flow">
          <h2>Impor daftar unit</h2>
          <p className="cell-sub">
            CSV dengan kolom <span className="num">id,name,level,parent_id</span>. Tingkat: {UNIT_LEVELS.join(', ')}. Kepala unit tidak diimpor; ditetapkan pemilik organisasi lewat usulan.
          </p>
          <textarea rows={5} className="num" value={units} onChange={(e) => setUnits(e.target.value)} placeholder={'id,name,level,parent_id\nfinance,Finance,departemen,direksi'} />
          <div className="form-actions">
            <button className="btn primary" disabled={!units.trim()} onClick={() => run(async () => `${(await api('POST', '/org/import/units', units)).imported} unit diimpor.`)}>
              Impor unit
            </button>
          </div>
        </section>
        <section className="sheet flow">
          <h2>Impor karyawan</h2>
          <p className="cell-sub">
            CSV dengan kolom <span className="num">id,email,name,unit_id,title</span>. Atasan tidak diimpor: dihitung dari unit. Karyawan baru mendapat password sementara.
          </p>
          <textarea rows={5} className="num" value={people} onChange={(e) => setPeople(e.target.value)} placeholder={'id,email,name,unit_id,title\nu_rina,rina@contoh.test,Rina,finance,Staf Akuntansi'} />
          <div className="form-actions">
            <button
              className="btn primary"
              disabled={!people.trim()}
              onClick={() =>
                run(async () => {
                  const res = await api('POST', '/admin/directory', people);
                  return `${res.imported} karyawan diimpor.${res.created.length ? ` Password sementara: ${res.created.map((c: any) => `${c.email} ${c.temporaryPassword}`).join('; ')}` : ''}`;
                })
              }
            >
              Impor karyawan
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
