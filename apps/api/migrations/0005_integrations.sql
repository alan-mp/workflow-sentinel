-- Integrasi dua arah. Sistem lain mengajukan permintaan lewat API dengan kunci per sistem,
-- dan diberi tahu hasil akhirnya lewat webhook. Logika approval tetap hanya di Sentinel.
CREATE TABLE api_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- Hanya hash kunci yang disimpan; kuncinya ditampilkan sekali saat dibuat.
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  -- Dipakai menandatangani webhook ke callback URL milik sistem ini.
  signing_secret TEXT NOT NULL,
  -- JSON array nama host yang boleh dipakai sebagai callback URL.
  callback_hosts TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

-- Asal permintaan yang masuk lewat API. external_ref membuat pengiriman ulang aman (idempoten).
CREATE TABLE request_sources (
  request_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  external_ref TEXT,
  callback_url TEXT
);
CREATE UNIQUE INDEX request_sources_ref ON request_sources (client_id, external_ref) WHERE external_ref IS NOT NULL;

-- Tujuan webhook yang didaftarkan admin. flow_key NULL berarti semua alur.
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  flow_key TEXT,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE webhook_deliveries (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  event TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
-- Satu kejadian hanya dikirim sekali ke satu tujuan.
CREATE UNIQUE INDEX webhook_deliveries_once ON webhook_deliveries (request_id, event, url);
CREATE INDEX webhook_deliveries_due ON webhook_deliveries (status, next_attempt_at);
