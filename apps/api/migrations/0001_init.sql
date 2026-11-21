CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  department TEXT NOT NULL,
  manager_id TEXT,
  roles TEXT NOT NULL DEFAULT '[]',
  is_admin INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE sop_documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE flow_versions (
  id TEXT PRIMARY KEY,
  flow_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  definition TEXT NOT NULL,
  sop_url TEXT,
  sop_document_id TEXT,
  citations TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  edited_by TEXT NOT NULL,
  effective_from TEXT,
  activated_by TEXT,
  activated_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (flow_key, version)
);

CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  flow_key TEXT NOT NULL,
  flow_version_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  status TEXT NOT NULL,
  state TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  assignees TEXT NOT NULL,
  status TEXT NOT NULL,
  due_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX tasks_open ON tasks (status, due_at);

CREATE TABLE delegations (
  id TEXT PRIMARY KEY,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  flow_version_id TEXT NOT NULL,
  request_id TEXT,
  step_id TEXT,
  task_id TEXT,
  detail TEXT
);
CREATE INDEX audit_request ON audit_events (request_id, seq);

CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events hanya bisa ditambah'); END;

CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit_events hanya bisa ditambah'); END;

CREATE TRIGGER version_active_frozen BEFORE UPDATE ON flow_versions WHEN OLD.status = 'active' BEGIN SELECT RAISE(ABORT, 'versi aktif tidak bisa diubah'); END;

CREATE TRIGGER version_active_no_delete BEFORE DELETE ON flow_versions WHEN OLD.status = 'active' BEGIN SELECT RAISE(ABORT, 'versi aktif tidak bisa dihapus'); END;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);
CREATE INDEX notifications_user ON notifications (user_id, created_at);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_version_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE write_guard (ok INTEGER NOT NULL CHECK (ok = 1));
