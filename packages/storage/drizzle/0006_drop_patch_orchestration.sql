-- Task #8: Drop the patch-orchestration tables (line 1 cleanup).
--
-- The patch-intents → patch-manifests → apply-manifests pipeline has been
-- replaced by AI-decided ProposedNextAction[], which the user picks via
-- POST /cases/:caseId/invoke-next. The application layer no longer reads or
-- writes any of these tables (routes + worker handlers removed in task #7).
--
-- This migration drops:
--   apply_manifests       (records of applied patches; rolled-back applies)
--   patch_manifests      (the generated patch operations + base hashes)
--   patch_intents        (the user's requested patch intent)
--   cases.current_patch_id  (FK pointer to the latest patch_manifests row)
--
-- Order matters: drop the FK children before their parents, and drop the
-- column before its referenced table. SQLite enforces no FK at drop time as
-- long as pragmas are off, but we follow the safe order anyway.
--
-- Data loss: any in-flight patch rows are discarded. This is intentional —
-- line 1 considers patch orchestration legacy state with no further use.

ALTER TABLE cases DROP COLUMN current_patch_id;
--> statement-breakpoint
DROP TABLE apply_manifests;
--> statement-breakpoint
DROP TABLE patch_manifests;
--> statement-breakpoint
DROP TABLE patch_intents;
