-- What Sentinel noticed about a request: deterministic anomaly flags (computed when the request is
-- filed) and an AI briefing for the approver (written in the background). One row per request,
-- replaced when the request is resubmitted. Flags are also recorded in the audit trail.
CREATE TABLE request_insights (
  request_id TEXT PRIMARY KEY,
  round INTEGER NOT NULL,
  anomalies TEXT NOT NULL DEFAULT '[]',
  summary TEXT,
  anomaly_note TEXT,
  -- pending: waiting for the AI; ready; failed (retried by cron); unavailable: AI not configured.
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX request_insights_retry ON request_insights (status, attempts);
