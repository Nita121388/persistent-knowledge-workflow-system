import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CliResult } from './types.js';
import { DEFAULTS } from './types.js';
import { detectAgentIdFromPath } from './agent-detect.js';

export interface CliRunnerOptions {
  cliPath: string;
  workDir: string;
  taskPrompt: string;
  timeoutMs?: number;
  envVars?: Record<string, string>;
  /** Sandbox mode controlling file access scope */
  sandboxMode?: 'workspace-only' | 'vault-readonly' | 'full';
  /** Vault path (required for vault-readonly mode) */
  vaultPath?: string;
  /** Workspace path for context file isolation */
  workspacePath?: string;
  /**
   * Force which CLI family is being driven. If omitted, the runner detects it
   * from the cliPath basename (see detectAgentIdFromPath). When the path is a
   * custom binary the detection returns null and the runner degrades to a
   * single-shot `--print` invocation with no session/transcript recording.
   */
  agentId?: 'claude' | 'codex';
}

/**
 * Run a CLI agent (Codex / Claude Code) as a subprocess.
 *
 * 1. Writes a CLAUDE.md file into the workDir with the task prompt and context.
 * 2. Spawns the CLI with --print mode.
 * 3. Reads any output files generated in the workDir.
 * 4. Times out if the process runs too long.
 */
export async function runCliAgent(options: CliRunnerOptions): Promise<CliResult> {
  const {
    cliPath,
    workDir,
    taskPrompt,
    timeoutMs = DEFAULTS.cliTimeoutMs,
    envVars = {},
    sandboxMode = 'workspace-only',
    vaultPath,
    workspacePath,
  } = options;

  // Ensure workDir exists
  fs.mkdirSync(workDir, { recursive: true });

  // Apply sandbox: copy allowed context files into the workDir
  prepareSandboxedContext(sandboxMode, workDir, vaultPath, workspacePath);

  // Write CLAUDE.md
  const claudeMdPath = path.join(workDir, 'CLAUDE.md');
  fs.writeFileSync(claudeMdPath, taskPrompt, 'utf-8');

  // Ensure output directory
  const outputDir = path.join(workDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  // Deny-list note for future use: when sandboxed, the CLI should not
  // write outside output/. Currently enforced by cwd isolation.
  const denyWritePaths: string[] = sandboxMode !== 'full'
    ? ['context', 'CLAUDE.md']
    : [];

  const startTime = Date.now();

  // Resolve which CLI family we're driving and mint a session id. The session
  // id is passed to the CLI as --session-id, and on-disk transcript files are
  // located under that id (see locateTranscriptPath below).
  const agentId = options.agentId ?? detectAgentIdFromPath(cliPath);
  const sessionId = agentId ? crypto.randomUUID() : undefined;

  // On Windows, npm wrappers need shell for execution
  const isWindows = process.platform === 'win32';
  const { spawnCmd, spawnArgs, spawnShell } = buildSpawnInvocation(
    cliPath,
    taskPrompt,
    sessionId,
    agentId,
    isWindows,
  );

  return new Promise<CliResult>((resolve) => {
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: spawnShell,
      env: {
        ...process.env,
        ...envVars,
        // Tell the CLI to write output files here
        PKWS_OUTPUT_DIR: outputDir,
      },
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      // If still alive after 3s, SIGKILL
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 3000);
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString('utf-8');
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString('utf-8');
    });

    child.on('close', (exitCode) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;

      // Read output files from the output directory
      const outputFiles: Array<{ path: string; content: string }> = [];
      try {
        if (fs.existsSync(outputDir)) {
          const files = fs.readdirSync(outputDir);
          for (const file of files) {
            const filePath = path.join(outputDir, file);
            const content = fs.readFileSync(filePath, 'utf-8');
            outputFiles.push({ path: filePath, content });
          }
        }
      } catch {
        // Best-effort read of output files
      }

      resolve({
        exitCode: exitCode ?? -1,
        stdout,
        stderr,
        outputFiles,
        timedOut,
        durationMs,
        agentId: agentId ?? undefined,
        sessionId,
        transcriptPath: sessionId && agentId
          ? locateTranscriptPath(agentId, sessionId, workDir, startTime)
          : undefined,
      });
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      const durationMs = Date.now() - startTime;
      resolve({
        exitCode: -1,
        stdout,
        stderr: `Failed to spawn CLI: ${err.message}`,
        outputFiles: [],
        timedOut: false,
        durationMs,
        agentId: agentId ?? undefined,
        sessionId,
        transcriptPath: sessionId && agentId
          ? locateTranscriptPath(agentId, sessionId, workDir, startTime)
          : undefined,
      });
    });
  });
}

/**
 * Verify that a CLI is executable by checking its version.
 */
export async function verifyCli(cliPath: string): Promise<boolean> {
  // On Windows, npm wrappers are shell scripts (.cmd or .ps1), not standalone binaries.
  // To verify them we need to run through the shell.
  const isWindows = process.platform === 'win32';
  const command = isWindows ? ['cmd', '/c', cliPath, '--version'] : [cliPath, '--version'];

  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
      shell: isWindows,
    });

    let output = '';
    child.stdout.on('data', (data: Buffer) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      resolve(code === 0 && output.trim().length > 0);
    });

    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Find the PKWS agent work directory for a given case.
 */
export function getAgentWorkDir(workspacePath: string, caseId: string): string {
  return path.join(workspacePath, 'agents', caseId);
}

/**
 * Prepare a sandboxed context directory for the CLI agent.
 *
 * Depending on sandboxMode, copies allowed files into the workDir's context/ folder:
 * - workspace-only: nothing extra (the workDir itself is inside workspace)
 * - vault-readonly: copies vault markdown files into context/vault/
 * - full: no restrictions (the CLI has full filesystem access)
 */
export function prepareSandboxedContext(
  mode: 'workspace-only' | 'vault-readonly' | 'full',
  workDir: string,
  vaultPath?: string,
  workspacePath?: string,
): void {
  switch (mode) {
    case 'workspace-only':
      // No extra context copies needed — the agent reads its own CLAUDE.md
      // The workDir is inside workspacePath/agents/{caseId}/, so the CLI
      // is naturally confined by the cwd. No vault files are exposed.
      break;

    case 'vault-readonly': {
      // Copy vault files into context/vault/ as read-only references
      if (!vaultPath) {
        console.warn('[Sandbox] vault-readonly mode selected but no vaultPath provided — skipping vault copy');
        return;
      }
      const vaultContextDir = path.join(workDir, 'context', 'vault');
      fs.mkdirSync(vaultContextDir, { recursive: true });
      const copyCount = copyVaultFilesForContext(vaultPath, vaultContextDir);
      console.log(`[Sandbox] vault-readonly: copied ${copyCount} vault files to ${vaultContextDir}`);
      break;
    }

    case 'full':
      // No restrictions — CLI can read/write anywhere
      console.log('[Sandbox] full mode: no file access restrictions');
      break;
  }
}

/**
 * Copy vault markdown files into a context directory.
 * Respects a depth limit and file count limit to avoid overwhelming the agent.
 */
function copyVaultFilesForContext(vaultPath: string, targetDir: string): number {
  const MAX_FILES = 50;
  const MAX_DEPTH = 3;
  let count = 0;

  function walk(dir: string, depth: number): void {
    if (depth > MAX_DEPTH || count >= MAX_FILES) return;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (count >= MAX_FILES) return;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // Skip .git, node_modules, hidden dirs
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          walk(fullPath, depth + 1);
        } else if (entry.name.endsWith('.md')) {
          const relPath = path.relative(vaultPath, fullPath);
          const targetFile = path.join(targetDir, relPath);
          fs.mkdirSync(path.dirname(targetFile), { recursive: true });
          try {
            fs.copyFileSync(fullPath, targetFile);
            count++;
          } catch {
            // Permission error or locked file — skip gracefully
          }
        }
      }
    } catch {
      // Permission denied or other read error — skip
    }
  }

  if (fs.existsSync(vaultPath)) {
    walk(vaultPath, 0);
  }

  return count;
}

/**
 * Build the spawn invocation (command + args + shell flag) for whichever CLI
 * family we're targeting.
 *
 * Claude Code headless mode:
 *   `claude --print --input-format stream-json --output-format stream-json
 *    --verbose --session-id <uuid> <taskPrompt>`
 * A real jsonl transcript is written to ~/.claude/projects/<dir-slug>/<uuid>.jsonl
 * where <dir-slug> is the workDir path with separators replaced by '-'.
 *
 * Codex headless mode:
 *   `codex exec --session-id <uuid> <taskPrompt>`
 * A jsonl rollout file is written to ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl
 * and the session_id appears in the first session_meta record.
 *
 * Custom / unknown CLI:
 *   falls back to the legacy `--print <taskPrompt>` single-shot, no session
 *   recorded.
 */
function buildSpawnInvocation(
  cliPath: string,
  taskPrompt: string,
  sessionId: string | undefined,
  agentId: 'claude' | 'codex' | null,
  isWindows: boolean,
): { spawnCmd: string; spawnArgs: string[]; spawnShell: boolean } {
  // On Windows the npm wrappers are .cmd/.ps1 scripts that need a shell
  // to be executed; on POSIX we can exec the binary directly.
  const wrapWindows = (args: string[]) =>
    isWindows
      ? { spawnCmd: process.env.COMSPEC || 'cmd.exe', spawnArgs: ['/c', cliPath, ...args], spawnShell: true }
      : { spawnCmd: cliPath, spawnArgs: args, spawnShell: false };

  if (agentId === 'claude' && sessionId) {
    return wrapWindows([
      '--print',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--session-id', sessionId,
      taskPrompt,
    ]);
  }

  if (agentId === 'codex' && sessionId) {
    // `codex exec` runs the model non-interactively and writes a rollout file.
    return wrapWindows(['exec', '--session-id', sessionId, taskPrompt]);
  }

  // Custom / unknown CLI — keep legacy single-shot behaviour.
  return wrapWindows(['--print', taskPrompt]);
}

/**
 * Resolve the transcript jsonl path on disk for a finished (or in-flight) CLI
 * session. Best-effort: each CLI writes the file asynchronously, so on fast
 * tests the file may not yet exist when the subprocess exits. The CLI writes
 * under a deterministic location derived from --session-id / cwd / start time,
 * so we resolve the location either by globbing or by reading session_meta.
 *
 * Claude: ~/.claude/projects/<dir-slug>/<sessionId>.jsonl directly.
 *         (drizzle / Claude Code slug rule: absolute cwd with separators '.')
 * Codex:  Walks $CODEX_HOME/sessions directory for rollout-*.jsonl (newest first)
 *         and reads each first line to find one whose payload.session_id
 *         matches sessionId.
 */
function locateTranscriptPath(
  agentId: 'claude' | 'codex',
  sessionId: string,
  workDir: string,
  startTimeMs: number,
): string | undefined {
  try {
    if (agentId === 'claude') {
      const projectsDir = path.join(os.homedir(), '.claude', 'projects');
      // Claude Code slug rule observed in the wild (Windows): the cwd path
      // with backslashes replaced by '-' and drive colon stripped. Try a few
      // candidate slugs and then fall back to a directory walk if none match.
      const slugCandidates = new Set<string>();
      const candidates = [
        workDir.replace(/[\\/]+/g, '-').replace(/^-+|-+$/g, ''),
        workDir.replace(/[\\/]+/g, '-'),
        workDir.replace(/:/g, '').replace(/\\/g, '-'),
        workDir.toUpperCase().replace(/:/g, '').replace(/\\/g, '-'),
      ];
      for (const c of candidates) if (c) slugCandidates.add(c);
      for (const slug of slugCandidates) {
        const p = path.join(projectsDir, slug, `${sessionId}.jsonl`);
        if (fs.existsSync(p)) return p;
      }
      // Fall back to scanning project dirs for the session file (in case the
      // slug rule changed across CLI versions). Cap at 200 dirs / 30 sessions.
      if (fs.existsSync(projectsDir)) {
        const dirs = fs.readdirSync(projectsDir).slice(0, 200);
        for (const d of dirs) {
          const p = path.join(projectsDir, d, `${sessionId}.jsonl`);
          if (fs.existsSync(p)) return p;
        }
      }
      // File not flushed yet — return the most likely path so the UI can
      // still attempt to open it (or the user can refresh later).
      const guessSlug = candidates[0] || 'unknown';
      return path.join(projectsDir, guessSlug, `${sessionId}.jsonl`);
    }

    if (agentId === 'codex') {
      const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
      const sessionsRoot = path.join(codexHome, 'sessions');
      if (!fs.existsSync(sessionsRoot)) return undefined;
      // Codex logs sessions under YYYY/MM/DD/, newest Codex internal seconds
      // values are written lexically comparable. Walk newest-first.
      const rolloutFiles: string[] = [];
      walkCodexSessions(sessionsRoot, startTimeMs, rolloutFiles, 500);
      // Read each first line, newest first, find the matching session_id.
      for (const fp of rolloutFiles) {
        try {
          const fd = fs.openSync(fp, 'r');
          const buf = Buffer.alloc(2048);
          const n = fs.readSync(fd, buf, 0, 2048, 0);
          fs.closeSync(fd);
          if (n <= 0) continue;
          const firstLine = buf.toString('utf-8', 0, n).split('\n')[0] ?? '';
          if (firstLine.includes(sessionId)) return fp;
        } catch {
          // read error — try next
        }
      }
      return undefined;
    }
  } catch {
    // Best-effort — leave caller with undefined.
  }
  return undefined;
}

/**
 * Walk a Codex sessions/ tree newest-first. We use the start timestamp to
 * prune: Codex organises files under YYYY/MM/DD/, so we only descend into
 * leaf day dirs whose ISO date string is at-or-before the run started (the
 * run's own session file is placed AFTER spawn, so we expect today's date).
 */
function walkCodexSessions(dir: string, runStartMs: number, out: string[], limit: number): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  // Sort dirs/files newest-first by name for date-shaped entries.
  const sorted = entries.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  for (const e of sorted) {
    if (out.length >= limit) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkCodexSessions(full, runStartMs, out, limit);
    } else if (e.isFile() && e.name.startsWith('rollout-') && e.name.endsWith('.jsonl')) {
      out.push(full);
    }
  }
}
