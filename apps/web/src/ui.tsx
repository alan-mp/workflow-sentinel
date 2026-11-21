import type { ReactNode } from 'react';
import { STATUS_LABEL, fmtSpan } from './api';

/** Tingkat status untuk warna: lulus, mendekati batas, di luar batas, berjalan, netral. */
const TONE: Record<string, 'ok' | 'warn' | 'bad' | 'run' | 'idle'> = {
  approved: 'ok',
  active: 'ok',
  rejected: 'bad',
  revision_requested: 'warn',
  draft: 'warn',
  in_progress: 'run',
  open: 'run',
  cancelled: 'idle',
  skipped: 'idle',
};

export const Badge = ({ status, label }: { status: string; label?: string }) => (
  <span className={`badge ${TONE[status] ?? 'idle'}`}>{label ?? STATUS_LABEL[status] ?? status}</span>
);

const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** Nama orang tanpa keterangan jabatan dalam kurung, dan jabatannya terpisah. */
export const splitName = (full: string): [string, string] => {
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(full);
  return m ? [m[1]!, m[2]!] : [full, ''];
};

export function Person({ name, sub, compact }: { name: string; sub?: string; compact?: boolean }) {
  const [short, role] = splitName(name);
  const detail = sub ?? role;
  return (
    <span className={`person ${compact ? 'compact' : ''}`}>
      <span className="avatar" aria-hidden="true">
        {initials(short)}
      </span>
      <span className="person-text">
        <span className="person-name">{short}</span>
        {detail && !compact ? <span className="person-sub">{detail}</span> : null}
      </span>
    </span>
  );
}

export type ToleranceLevel = 'ok' | 'near' | 'out' | 'none';

/** Posisi tugas terhadap batas SLA: rasio waktu terpakai dibanding jatah. */
export function tolerance(createdAt?: string | null, dueAt?: string | null, now = Date.now()): { level: ToleranceLevel; ratio: number; left: number } {
  if (!createdAt || !dueAt) return { level: 'none', ratio: 0, left: 0 };
  const start = Date.parse(createdAt);
  const due = Date.parse(dueAt);
  const span = Math.max(due - start, 60_000);
  const ratio = (now - start) / span;
  return { level: ratio >= 1 ? 'out' : ratio >= 0.75 ? 'near' : 'ok', ratio, left: due - now };
}

export const TOLERANCE_LABEL: Record<ToleranceLevel, string> = {
  ok: 'Dalam batas',
  near: 'Mendekati batas',
  out: 'Lewat batas',
  none: 'Tanpa tenggat',
};

/** Lebar zona spesifikasi pada pita (sisanya zona lewat batas), dan letak tanda 75%. */
const LIMIT = 70;
const WARN = LIMIT * 0.75;

/**
 * Pita toleransi: jatah SLA digambar sampai garis batas; keterlambatan menjadi segmen merah
 * terpisah di zona lewat batas, dengan skala dipadatkan (lewat 1× SLA mengisi separuh zona),
 * sehingga telat 6 jam dan telat 28 jam terbaca berbeda.
 */
export function ToleranceBar({ createdAt, dueAt, wide }: { createdAt?: string | null; dueAt?: string | null; wide?: boolean }) {
  const t = tolerance(createdAt, dueAt);
  if (t.level === 'none') return <span className="tol-none">Tanpa tenggat</span>;
  const inSpec = Math.min(Math.max(t.ratio, 0), 1) * LIMIT;
  const over = Math.max(t.ratio - 1, 0);
  const overrun = (over / (over + 1)) * (100 - LIMIT);
  const text = t.left >= 0 ? `sisa ${fmtSpan(t.left)}` : `lewat ${fmtSpan(-t.left)}`;
  return (
    <span className={`tol ${t.level} ${wide ? 'wide' : ''}`} title={`${TOLERANCE_LABEL[t.level]}: ${text}`}>
      <span className="tol-track" aria-hidden="true">
        <span className="tol-zone" style={{ left: `${LIMIT}%` }} />
        <span className="tol-fill" style={{ width: `${inSpec}%` }} />
        {overrun > 0 ? <span className="tol-over" style={{ left: `${LIMIT}%`, width: `${overrun}%` }} /> : null}
        <span className="tol-warn" style={{ left: `${WARN}%` }} />
        <span className="tol-limit" style={{ left: `${LIMIT}%` }} />
      </span>
      <span className="tol-text">{text}</span>
    </span>
  );
}

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <h1>{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-body">{children}</p> : null}
    </div>
  );
}

export const Loading = ({ label = 'Memuat…' }: { label?: string }) => (
  <div className="loading" role="status">
    <span className="spinner" aria-hidden="true" />
    {label}
  </div>
);

export const ErrorNote = ({ children }: { children: ReactNode }) =>
  children ? (
    <p className="error-note" role="alert">
      {children}
    </p>
  ) : null;
