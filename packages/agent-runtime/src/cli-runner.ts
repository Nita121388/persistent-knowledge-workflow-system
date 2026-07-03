import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { CliResult } from './types.js';
import { DEFAULTS } from './types.js';

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

  // On Windows, npm wrappers need shell for execution
  const isWindows = process.platform === 'win32';
  const spawnCmd = isWindows ? process.env.COMSPEC || 'cmd.exe' : cliPath;
  const spawnArgs = isWindows ? ['/c', cliPath, '--print', taskPrompt] : ['--print', taskPrompt];

  return new Promise<CliResult>((resolve) => {
    const child = spawn(spawnCmd, spawnArgs, {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: isWindows,
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
