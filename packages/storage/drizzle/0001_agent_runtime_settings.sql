ALTER TABLE settings ADD COLUMN agent_runtime_enabled integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN agent_cli_path text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN auto_detect_agents integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN max_active_sessions integer DEFAULT 10 NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN session_timeout_minutes integer DEFAULT 360 NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN context_compress_threshold integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN context_keep_recent_count integer DEFAULT 12 NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN max_tokens_per_session integer DEFAULT 32000 NOT NULL;
--> statement-breakpoint
ALTER TABLE settings ADD COLUMN sandbox_mode text DEFAULT 'workspace-only' NOT NULL;
