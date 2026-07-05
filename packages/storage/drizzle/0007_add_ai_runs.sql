-- Task #10: Add ai_runs table (line 2 — per-node AI processing log).
--
-- ai_runs replaces the case-level single AI summary with one row per AI
-- processing node on a case. Two write paths feed it:
--   (a) generate_proposal path — kind='proposal'. Linked to the produced
--       proposal row through proposal_id.
--   (b) invoke-next path      — kind='turn'. proposal_id is null.
--
-- Each row persists both halves of the per-node recipe:
--   rules_snapshot_json     the workspace Rules snapshot fed to the AI this turn
--   input_context_json      the actual note material / prior summary / user
--                           comments fed to the AI this turn
-- Plus the AI output:
--   output_summary           short summary text of the AI output
--   proposed_next_actions_json  JSON of ProposedNextAction[] the AI surfaced
-- Plus lifecycle bookkeeping:
--   status enum('running' | 'succeeded' | 'failed' | 'aborted')
--   error text
--   started_at / finished_at / duration_ms
--
-- Indexes:
--   idx_ai_runs_case    hot path: case detail page selects by case_id
--   idx_ai_runs_kind    optional filter: list node-type filter
--   idx_ai_runs_status  optional filter: filter only in-flight runs

CREATE TABLE `ai_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`model` text NOT NULL,
	`status` text NOT NULL DEFAULT 'running',
	`error` text,
	`rules_snapshot_json` text NOT NULL,
	`input_context_json` text NOT NULL,
	`output_summary` text,
	`proposed_next_actions_json` text,
	`proposal_id` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	`duration_ms` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ai_runs_case` ON `ai_runs` (`case_id`);
--> statement-breakpoint
CREATE INDEX `idx_ai_runs_kind` ON `ai_runs` (`kind`);
--> statement-breakpoint
CREATE INDEX `idx_ai_runs_status` ON `ai_runs` (`status`);
