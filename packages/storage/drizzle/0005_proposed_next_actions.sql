-- Task #3: Proposal schema migration to AI-decided proposedNextActions[]
--
-- Replaces the old hardcoded scaffolding:
--   suggested_actions         TEXT NOT NULL              (JSON enum array)
--   suggested_target_path     TEXT                       (nullable)
--   requires_patch            INTEGER NOT NULL           (boolean)
-- with a single AI-decided column:
--   proposed_next_actions     TEXT NOT NULL DEFAULT '[]' (JSON of ProposedNextAction[])
--
-- Existing rows keep working: their proposed_next_actions defaults to '[]'
-- (empty menu). Users can trigger regenerate on legacy cases to populate the
-- new menu with current Rules, since the old enum-driven menu no longer
-- applies under the unified ai_turn model.

ALTER TABLE proposals ADD COLUMN proposed_next_actions TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE proposals DROP COLUMN suggested_actions;
--> statement-breakpoint
ALTER TABLE proposals DROP COLUMN suggested_target_path;
--> statement-breakpoint
ALTER TABLE proposals DROP COLUMN requires_patch;
