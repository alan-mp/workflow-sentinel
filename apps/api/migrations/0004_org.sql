-- Master organisasi milik Sentinel. Atasan dihitung dari pohon unit; tidak disimpan per orang.
CREATE TABLE org_units (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  parent_id TEXT,
  head_user_id TEXT,
  acting_head_user_id TEXT,
  acting_until TEXT
);

ALTER TABLE users ADD COLUMN unit_id TEXT;
ALTER TABLE users ADD COLUMN title TEXT;

-- Pengecualian pelaporan: selalu punya alasan dan masa berlaku.
CREATE TABLE reporting_exceptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  flow_key TEXT,
  reason TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL
);

-- Matriks wewenang: siapa berhak menyetujui hal tertentu, opsional dibatasi ke satu cabang unit.
CREATE TABLE authorities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE authority_holders (
  authority_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  scope_unit_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (authority_id, user_id, scope_unit_id)
);

-- Peran lama di kolom users.roles menjadi wewenang.
INSERT INTO authorities (id, name) SELECT DISTINCT r.value, r.value FROM users u, json_each(u.roles) r;
INSERT INTO authority_holders (authority_id, user_id) SELECT r.value, u.id FROM users u, json_each(u.roles) r;

-- Pemilik master organisasi (minimal dua), ditunjuk admin sistem.
CREATE TABLE org_owners (
  user_id TEXT PRIMARY KEY,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL
);

-- Setiap perubahan struktur diusulkan satu orang, ditinjau orang kedua, lalu berlaku pada tanggalnya.
CREATE TABLE org_changes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  summary TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  proposed_at TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  applied_at TEXT,
  impact TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX org_changes_status ON org_changes (status, effective_from);
