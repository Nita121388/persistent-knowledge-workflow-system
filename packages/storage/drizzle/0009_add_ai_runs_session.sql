-- Task #18: Add session/transcript telemetry columns to ai_runs.
--
-- After switching the CLI runner from `claude --print` single-shot to the
-- stream-json multi-turn mode (Claude) and `codex exec` (Codex), each AI run
-- now produces a real, on-disk session transcript written by the agent CLI
-- itself — independent of whatever PKWS records in input/output columns.
--
-- Three columns are added so the front end can show a "Open session" affordance
-- on every AiRunCard:
--   agent_id         'claude' | 'codex' (which CLI produced this run; null for
--                    rows written before this telemetry existed / for the
--                    Job Queue path that doesn't shell out to a CLI)
--   session_id       UUID the CLI was asked to use as --session-id. Matches the
--                    `session_id` field in the jsonl transcript's first record.
--   transcript_path  Absolute path of the transcript jsonl on this machine.
--                    Claude: ~/.claude/projects/<dir-slug>/<session_id>.jsonl
--                    Codex:   ~/.codex/sessions/YYYY/MM/DD/rollout-*-<session_id>.jsonl
--                    Path resolution is best-effort: filled by the CLI runner
--                    immediately after the run; if absent at write time (race
--                    with file flush), the front end may still re-derive it
--                    from agent_id + session_id via a lookup endpoint.

ALTER TABLE `ai_runs` ADD COLUMN `agent_id` text;
ALTER TABLE `ai_runs` ADD COLUMN `session_id` text;
ALTER TABLE `ai_runs` ADD COLUMN `transcript_path` text;
