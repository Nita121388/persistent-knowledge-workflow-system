CREATE TABLE IF NOT EXISTS log_entries (
  id TEXT PRIMARY KEY NOT NULL,
  timestamp TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('debug', 'info', 'warn', 'error')),
  category TEXT NOT NULL CHECK(category IN ('system', 'api', 'agent', 'worker', 'ai', 'db', 'ws', 'user')),
  message TEXT NOT NULL,
  data_json TEXT,
  case_id TEXT,
  job_id TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_log_timestamp ON log_entries(timestamp);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_log_level ON log_entries(level);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_log_category ON log_entries(category);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_log_case ON log_entries(case_id);
