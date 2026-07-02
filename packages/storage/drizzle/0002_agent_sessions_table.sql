CREATE TABLE `agent_sessions` (
	`case_id` text PRIMARY KEY NOT NULL,
	`messages_json` text NOT NULL,
	`compressed_summary` text,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`compression_epoch` integer DEFAULT 0 NOT NULL,
	`awaiting_user_input` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_agent_sessions_updated` ON `agent_sessions` (`updated_at`);
