CREATE TABLE `apply_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`patch_manifest_id` text NOT NULL,
	`status` text NOT NULL,
	`applied_operations_json` text NOT NULL,
	`backup_refs_json` text NOT NULL,
	`applied_at` text NOT NULL,
	`rolled_back_at` text,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patch_manifest_id`) REFERENCES `patch_manifests`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`anchor_id` text NOT NULL,
	`type` text NOT NULL,
	`vault_path` text NOT NULL,
	`title` text,
	`source_url` text,
	`content_hash` text NOT NULL,
	`frontmatter_json` text,
	`captured_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`anchor_id`) REFERENCES `knowledge_anchors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `case_instruction_summaries` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`summary` text NOT NULL,
	`invalidated_items_json` text,
	`updated_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `case_instruction_summaries_case_id_unique` ON `case_instruction_summaries` (`case_id`);--> statement-breakpoint
CREATE TABLE `cases` (
	`id` text PRIMARY KEY NOT NULL,
	`anchor_id` text NOT NULL,
	`primary_artifact_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`current_proposal_id` text,
	`current_patch_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`anchor_id`) REFERENCES `knowledge_anchors`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`primary_artifact_id`) REFERENCES `artifacts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_cases_status` ON `cases` (`status`);--> statement-breakpoint
CREATE INDEX `idx_cases_anchor` ON `cases` (`anchor_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`payload_json` text NOT NULL,
	`result_json` text,
	`error_message` text,
	`retry_count` integer DEFAULT 0 NOT NULL,
	`idempotency_key` text,
	`created_at` text NOT NULL,
	`started_at` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_jobs_status` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_jobs_type` ON `jobs` (`type`);--> statement-breakpoint
CREATE TABLE `knowledge_anchors` (
	`id` text PRIMARY KEY NOT NULL,
	`current_vault_path` text NOT NULL,
	`original_vault_path` text NOT NULL,
	`title` text,
	`source_url` text,
	`first_seen_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `patch_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`proposal_id` text,
	`action` text NOT NULL,
	`instruction` text,
	`target_path` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pi_case` ON `patch_intents` (`case_id`);--> statement-breakpoint
CREATE TABLE `patch_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`patch_intent_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`operations_json` text NOT NULL,
	`base_file_hashes_json` text NOT NULL,
	`preview_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patch_intent_id`) REFERENCES `patch_intents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_pm_case` ON `patch_manifests` (`case_id`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`model` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`value_judgement` text NOT NULL,
	`suggested_actions` text NOT NULL,
	`suggested_target_path` text,
	`reasoning_summary` text NOT NULL,
	`risks` text,
	`requires_patch` integer NOT NULL,
	`raw_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_proposals_case` ON `proposals` (`case_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`vault_path` text NOT NULL,
	`inbox_path` text NOT NULL,
	`workspace_path` text NOT NULL,
	`ai_provider` text NOT NULL,
	`ai_base_url` text NOT NULL,
	`ai_api_key_encrypted` text,
	`ai_default_model` text NOT NULL,
	`ai_max_tokens` integer,
	`auto_analyze` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timeline_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`type` text NOT NULL,
	`actor` text NOT NULL,
	`summary` text NOT NULL,
	`data_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `cases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_events_case` ON `timeline_events` (`case_id`);--> statement-breakpoint
CREATE INDEX `idx_events_created` ON `timeline_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
