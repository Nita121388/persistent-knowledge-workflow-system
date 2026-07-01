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
  } = options;

  // Ensure workDir exists
  fs.mkdirSync(workDir, { recursive: true });

  // Write CLAUDE.md
  const claudeMdPath = path.join(workDir, 'CLAUDE.md');
  fs.writeFileSync(claudeMdPath, taskPrompt, 'utf-8');

  // Ensure output directory
  const outputDir = path.join(workDir, 'output');
  fs.mkdirSync(outputDir, { recursive: true });

  const startTime = Date.now();

  return new Promise<CliResult>((resolve) => {
    const child = spawn(cliPath, ['--print', taskPrompt], {
      cwd: workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
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
  return new Promise((resolve) => {
    const child = spawn(cliPath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
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
