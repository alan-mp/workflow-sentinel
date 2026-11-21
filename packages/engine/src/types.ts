import type { UnitLevel } from './definition';

/** Data karyawan seminimal mungkin untuk routing (UU PDP: akses seperlunya). */
export interface User {
  id: string;
  name: string;
  department: string;
  /** Unit organisasi tempat orang ini berada. Atasan dihitung dari unit, tidak disimpan per orang. */
  unitId?: string;
  /** Wewenang yang dipegang; hanya dipakai direktori di memori. */
  roles?: string[];
}

/** Satu unit di pohon organisasi. Tiap unit punya paling banyak satu kepala. */
export interface OrgUnit {
  id: string;
  name: string;
  level: UnitLevel;
  parentId?: string;
  headUserId?: string;
  /** Pejabat sementara (Plt); hanya berlaku selama kepala kosong dan sebelum `actingUntil`. */
  actingHeadUserId?: string;
  actingUntil?: string;
}

/** Pengecualian pelaporan: `userId` melapor ke `toUserId`, tercatat dengan alasan dan masa berlaku. */
export interface ReportingException {
  userId: string;
  toUserId: string;
  /** Kosong berarti berlaku untuk semua alur. */
  flowKey?: string;
  reason: string;
  startsAt: string;
  endsAt: string;
}

/** Pemegang sebuah wewenang, opsional dibatasi ke satu cabang pohon organisasi. */
export interface AuthorityHolder {
  userId: string;
  scopeUnitId?: string;
}

/** Sumber struktur organisasi. Implementasinya adapter (database, CSV, sistem HR). */
export interface Directory {
  getUser(id: string): Promise<User | undefined>;
  getUnit(id: string): Promise<OrgUnit | undefined>;
  getExceptions(userId: string): Promise<ReportingException[]>;
  getAuthorityHolders(authorityId: string): Promise<AuthorityHolder[]>;
}

/** Delegasi berbatas waktu: `toUserId` boleh bertindak atas nama `fromUserId`. */
export interface Delegation {
  fromUserId: string;
  toUserId: string;
  startsAt: string;
  endsAt: string;
  /** Pembuat delegasi; berbeda dari `fromUserId` kalau dibuatkan oleh atasan. */
  createdBy?: string;
}

/** AI punya tipe aktor sendiri supaya bisa ditolak secara eksplisit. */
export type Actor = { type: 'user'; id: string } | { type: 'ai'; id: string } | { type: 'system' };

/** Satu baris audit trail. Hanya pernah ditambah, tidak diubah. */
export interface AuditEvent {
  at: string;
  actor: Actor;
  action: string;
  flowVersionId: string;
  requestId?: string;
  stepId?: string;
  taskId?: string;
  detail?: Record<string, unknown>;
}

export type ErrorCode =
  | 'SOD_VIOLATION'
  | 'NOT_ASSIGNEE'
  | 'ROUTING'
  | 'INVALID_STATE'
  | 'INVALID_DATA'
  | 'INVALID_DEFINITION'
  | 'FORBIDDEN';

export class EngineError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EngineError';
  }
}

export interface DirectorySnapshot {
  users: User[];
  units?: OrgUnit[];
  exceptions?: ReportingException[];
  /** Kalau kosong, pemegang wewenang diturunkan dari `roles` tiap user (tanpa cakupan). */
  holders?: Record<string, AuthorityHolder[]>;
}

export class InMemoryDirectory implements Directory {
  private users: Map<string, User>;
  private units: Map<string, OrgUnit>;
  readonly snapshot: Required<DirectorySnapshot>;
  constructor(input: User[] | DirectorySnapshot) {
    const s = Array.isArray(input) ? { users: input } : input;
    const holders: Record<string, AuthorityHolder[]> = s.holders ?? {};
    if (!s.holders) {
      for (const u of s.users) for (const r of u.roles ?? []) (holders[r] ??= []).push({ userId: u.id });
    }
    this.snapshot = { users: s.users, units: s.units ?? [], exceptions: s.exceptions ?? [], holders };
    this.users = new Map(s.users.map((u) => [u.id, u]));
    this.units = new Map(this.snapshot.units.map((u) => [u.id, u]));
  }
  async getUser(id: string) {
    return this.users.get(id);
  }
  async getUnit(id: string) {
    return this.units.get(id);
  }
  async getExceptions(userId: string) {
    return this.snapshot.exceptions.filter((e) => e.userId === userId);
  }
  async getAuthorityHolders(authorityId: string) {
    return this.snapshot.holders[authorityId] ?? [];
  }
}
