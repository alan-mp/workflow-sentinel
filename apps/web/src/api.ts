export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: any,
  ) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const isRaw = body instanceof FormData || typeof body === 'string';
  const res = await fetch(`/api${url}`, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined && !isRaw ? { 'content-type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isRaw ? (body as BodyInit) : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) throw new ApiError(json?.error ?? `Request failed (${res.status}). Try again.`, res.status, json);
  return json as T;
}

export const fmtTime = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

export function fmtDuration(fromIso: string, toIso: string): string {
  const minutes = Math.max(0, Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

/** Rentang waktu singkat: "45 mnt", "3 j 20 mnt", "2 hari 4 j". */
export function fmtSpan(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  return hours % 24 ? `${Math.floor(hours / 24)} d ${hours % 24} h` : `${Math.floor(hours / 24)} d`;
}

export const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-';

export const STATUS_LABEL: Record<string, string> = {
  in_progress: 'In progress',
  approved: 'Approved',
  rejected: 'Rejected',
  revision_requested: 'Needs revision',
  open: 'Pending',
  cancelled: 'Cancelled',
  skipped: 'Skipped',
  draft: 'Draft',
  active: 'Active',
};
