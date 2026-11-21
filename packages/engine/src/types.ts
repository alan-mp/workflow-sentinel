/** Data karyawan seminimal mungkin untuk routing (UU PDP: akses seperlunya). */
export interface User {
  id: string;
  name: string;
  department: string;
  managerId?: string;
  roles: string[];
}

/** Sumber struktur organisasi. Implementasinya adapter (CSV, IdP, sistem HR). */
export interface Directory {
  getUser(id: string): Promise<User | undefined>;
  getUsersByRole(role: string): Promise<User[]>;
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

export class InMemoryDirectory implements Directory {
  private users: Map<string, User>;
  constructor(users: User[]) {
    this.users = new Map(users.map((u) => [u.id, u]));
  }
  async getUser(id: string) {
    return this.users.get(id);
  }
  async getUsersByRole(role: string) {
    return [...this.users.values()].filter((u) => u.roles.includes(role));
  }
}
