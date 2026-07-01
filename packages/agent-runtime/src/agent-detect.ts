import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import type { AgentInfo } from './types.js';

/**
 * Find a CLI executable on the system PATH.
 * Returns the full path if found, or null.
 */
function findCliOnPath(name: string): string | null {
  // On Windows, try with .cmd/.exe extensions
  const extensions = process.platform === 'win32'
    ? ['', '.cmd', '.exe', '.bat']
    : [''];

  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, `${name}${ext}`);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
  }
  return null;
}

/**
 * Check if a directory exists.
 */
function dirExists(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Detect Codex CLI.
 * Checks: $CODEX_HOME/sessions/ → ~/.codex/sessions/ → PATH for 'codex'
 */
function detectCodex(): AgentInfo | null {
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const sessionsDir = path.join(codexHome, 'sessions');
  const cliPath = findCliOnPath('codex');

  if (cliPath || dirExists(sessionsDir)) {
    return {
      id: 'codex',
      name: 'Codex CLI',
      path: cliPath,
      sessionsDir: dirExists(sessionsDir) ? sessionsDir : undefined,
    };
  }
  return null;
}

/**
 * Detect Claude Code.
 * Checks: $CLAUDE_CONFIG_DIR/projects/ → ~/.claude/projects/ → ~/.cache/claude/projects/
 * → PATH for 'claude'
 */
function detectClaude(): AgentInfo | null {
  const dirsToCheck = [
    process.env.CLAUDE_CONFIG_DIR && path.join(process.env.CLAUDE_CONFIG_DIR, 'projects'),
    path.join(os.homedir(), '.claude', 'projects'),
    // ~/.cache/claude/projects is Linux/macOS only
    process.platform !== 'win32' && path.join(os.homedir(), '.cache', 'claude', 'projects'),
  ].filter((d): d is string => !!d);

  const cliPath = findCliOnPath('claude');
  const projectDirs = dirsToCheck.filter(dirExists);
  const found = cliPath || projectDirs.length > 0;

  if (found) {
    return {
      id: 'claude',
      name: 'Claude Code',
      path: cliPath,
      projectDirs: projectDirs.length > 0 ? projectDirs : undefined,
    };
  }
  return null;
}

/**
 * Detect all available CLI agents on this system.
 * Returns a list of AgentInfo sorted by priority (Codex first, then Claude).
 */
export function detectAvailableAgents(): AgentInfo[] {
  const agents: AgentInfo[] = [];

  const codex = detectCodex();
  if (codex) agents.push(codex);

  const claude = detectClaude();
  if (claude) agents.push(claude);

  return agents;
}

/**
 * Resolve the effective CLI path to use.
 * If userOverride is provided, use it.
 * Otherwise auto-detect — prefer Codex over Claude.
 * Returns the resolved CLI command string (e.g. 'codex', '/usr/bin/claude', 'npx codex').
 */
export function resolveCliPath(userOverride?: string): string {
  if (userOverride) {
    // If it's a known name, verify it's on PATH
    if (!userOverride.includes('/') && !userOverride.includes('\\')) {
      const found = findCliOnPath(userOverride);
      if (found) return found;
    }
    return userOverride;
  }

  // Auto-detect: prefer Codex, fallback to Claude
  const agents = detectAvailableAgents();
  if (agents.length > 0 && agents[0].path) {
    return agents[0].path;
  }

  // Last resort: try bare names
  const codexPath = findCliOnPath('codex');
  if (codexPath) return codexPath;

  const claudePath = findCliOnPath('claude');
  if (claudePath) return claudePath;

  throw new Error(
    'No CLI agent detected. Install Codex CLI or Claude Code, or set a custom CLI path in Settings.',
  );
}

/**
 * Quick check whether any agent is available.
 */
export function isAnyAgentAvailable(): boolean {
  return detectAvailableAgents().length > 0;
}
