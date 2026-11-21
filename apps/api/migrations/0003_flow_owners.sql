CREATE TABLE flow_owners (
  flow_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (flow_key, user_id)
);
