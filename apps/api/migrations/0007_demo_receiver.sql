-- Only used when DEMO_APPS is "on" (the test environment): a stand-in for another internal system that
-- receives Sentinel's webhooks, so an integration can be shown end to end. Holds sample data only.
CREATE TABLE demo_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  event TEXT,
  delivery_id TEXT,
  signature TEXT,
  body TEXT NOT NULL
);
CREATE TABLE demo_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
