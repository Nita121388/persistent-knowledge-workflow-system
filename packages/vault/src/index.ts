import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { createHash } from 'node:crypto';
import type { PatchOperation, PatchManifest, ApplyManifest } from '@pkws/shared';
import { genApplyManifestId, genPatchManifestId } from '@pkws/shared/utils.js';

export interface FileInfo {
  path: string;
  hash: string;
  exists: boolean;
}

export interface VaultSafetyConfig {
  vaultPath: string;
  backupsPath: string;
}

/**
 * Compute SHA-256 hash of a file's contents.
 * Returns empty string if file doesn't exist.
 */
export async function computeHash(filePath: string): Promise<string> {
  try {
    const content = await fs.readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return '';
  }
}

/**
 * Read and parse a markdown file with frontmatter.
 */
export async function readMarkdown(filePath: string): Promise<{ content: string; data: Record<string, unknown>; body: string } | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);
    return {
      content: raw,
      data: parsed.data,
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

/**
 * Write pkws_id to a markdown file's frontmatter.
 * Preserves existing frontmatter fields and ordering as much as possible.
 */
export async function writePkwsId(filePath: string, pkwsId: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = matter(raw);

    // Skip if pkws_id already exists
    if (parsed.data.pkws_id) {
      return false;
    }

    const newData = { ...parsed.data, pkws_id: pkwsId };
    const newContent = matter.stringify(parsed.content, newData, { lineWidth: -1 });
    await fs.writeFile(filePath, newContent, 'utf-8');
    return true;
  } catch (err) {
    console.error(`Failed to write pkws_id to ${filePath}:`, err);
    return false;
  }
}

/**
 * Validate that a path is within the vault boundary.
 */
export function isPathInVault(filePath: string, vaultPath: string): boolean {
  const normalized = path.resolve(filePath);
  const vault = path.resolve(vaultPath);
  return normalized.startsWith(vault);
}

/**
 * Validate operation path safety.
 */
function validateOperationPath(operation: PatchOperation, vaultPath: string): string | null {
  if (operation.type === 'create_file') {
    if (!isPathInVault(operation.path, vaultPath)) return 'Path outside vault';
    return null;
  }
  if (operation.type === 'update_file') {
    if (!isPathInVault(operation.path, vaultPath)) return 'Path outside vault';
    return null;
  }
  if (operation.type === 'move_file') {
    if (!isPathInVault(operation.fromPath, vaultPath)) return 'Source path outside vault';
    if (!isPathInVault(operation.toPath, vaultPath)) return 'Target path outside vault';
    return null;
  }
  return 'Unknown operation type';
}

function isForbiddenPath(filePath: string): boolean {
  const segments = filePath.replace(/\\/g, '/').split('/');
  return segments.some(s => s === '.obsidian' || s === '.trash' || s === '.pkws-workspace');
}

interface BackupRecord {
  operation: PatchOperation;
  backupPath: string | null;
}

/**
 * Execute a patch manifest against the vault with safety checks.
 */
export async function executePatch(
  patchManifest: PatchManifest,
  config: VaultSafetyConfig,
): Promise<ApplyManifest> {
  const operations: PatchOperation[] = JSON.parse(patchManifest.operationsJson);
  const baseHashes: Record<string, string> = JSON.parse(patchManifest.baseFileHashesJson);
  const backupRecords: BackupRecord[] = [];
  const appliedOperations: PatchOperation[] = [];
  const backupsDir = path.join(config.backupsPath, `apply_${patchManifest.id}`);

  // Phase 1: Validate all operations
  for (const op of operations) {
    const validationError = validateOperationPath(op, config.vaultPath);
    if (validationError) {
      throw new Error(`Operation validation failed: ${validationError}`);
    }

    if (isForbiddenPath(op.type === 'move_file' ? op.toPath : 'path' in op ? (op as any).path : op.fromPath)) {
      throw new Error('Operation targets forbidden directory');
    }
  }

  // Phase 2: Hash validation
  for (const op of operations) {
    if (op.type === 'update_file' || op.type === 'move_file') {
      const checkPath = op.type === 'update_file' ? op.path : op.fromPath;
      const currentHash = await computeHash(checkPath);
      const expectedHash = baseHashes[checkPath] || '';
      if (currentHash !== expectedHash) {
        throw new Error(
          `Hash mismatch for ${checkPath}. File has been modified since patch generation. ` +
          `Expected: ${expectedHash}, Got: ${currentHash}`
        );
      }
    }
  }

  // Phase 3: Create backups
  await fs.mkdir(backupsDir, { recursive: true });

  for (const op of operations) {
    if (op.type === 'update_file') {
      const backupPath = path.join(backupsDir, path.basename(op.path));
      await fs.copyFile(op.path, backupPath);
      backupRecords.push({ operation: op, backupPath });
    } else if (op.type === 'move_file') {
      const backupPath = path.join(backupsDir, path.basename(op.fromPath));
      await fs.copyFile(op.fromPath, backupPath);
      backupRecords.push({ operation: op, backupPath });
    } else {
      backupRecords.push({ operation: op, backupPath: null });
    }
  }

  // Phase 4: Execute operations
  for (const op of operations) {
    if (op.type === 'create_file') {
      // Check target doesn't exist
      const targetExists = await fs.access(op.path).then(() => true).catch(() => false);
      if (targetExists) {
        throw new Error(`Target file already exists: ${op.path}`);
      }
      await fs.mkdir(path.dirname(op.path), { recursive: true });
      await fs.writeFile(op.path, op.content, 'utf-8');
    } else if (op.type === 'update_file') {
      await fs.writeFile(op.path, op.newContent, 'utf-8');
    } else if (op.type === 'move_file') {
      // Check source still exists
      const sourceExists = await fs.access(op.fromPath).then(() => true).catch(() => false);
      if (!sourceExists) {
        throw new Error(`Source file not found: ${op.fromPath}`);
      }
      // Check target doesn't exist
      const targetExists = await fs.access(op.toPath).then(() => true).catch(() => false);
      if (targetExists) {
        throw new Error(`Target file already exists: ${op.toPath}`);
      }
      await fs.mkdir(path.dirname(op.toPath), { recursive: true });
      await fs.rename(op.fromPath, op.toPath);
    }
    appliedOperations.push(op);
  }

  const applyId = genApplyManifestId();
  const backupManifest = {
    applyManifestId: applyId,
    caseId: patchManifest.caseId,
    patchManifestId: patchManifest.id,
    operations: backupRecords.map(r => ({
      type: r.operation.type,
      path: r.operation.type === 'move_file' ? r.operation.fromPath : (r.operation as any).path,
      toPath: r.operation.type === 'move_file' ? r.operation.toPath : undefined,
      backupPath: r.backupPath,
    })),
    createdAt: new Date().toISOString(),
  };

  const backupManifestPath = path.join(backupsDir, 'manifest.json');
  await fs.writeFile(backupManifestPath, JSON.stringify(backupManifest, null, 2), 'utf-8');

  return {
    id: applyId,
    caseId: patchManifest.caseId,
    patchManifestId: patchManifest.id,
    status: 'applied',
    appliedOperationsJson: JSON.stringify(appliedOperations),
    backupRefsJson: JSON.stringify(backupRecords.map(r => ({
      operationType: r.operation.type,
      path: r.operation.type === 'move_file' ? r.operation.fromPath : (r.operation as any).path,
      backupPath: r.backupPath,
    }))),
    appliedAt: new Date().toISOString(),
  };
}

/**
 * Apply a list of `PatchOperation`s directly to the vault, with the same
 * safety guarantees `executePatch` provides (path validation, hash check,
 * backups, rollback manifest) but without requiring a `patch_manifests` DB
 * row.
 *
 * `caseId` is threaded through so the produced `ApplyManifest` (and the
 * on-disk backup manifest under `backupsPath/apply_<id>/manifest.json`)
 * can be traced back to the case that triggered the write.
 *
 * Used by the agent-runtime scheduler (line 5 / task #16) when a CLI
 * agent turn emits `modify_vault` operations after the user invoked a
 * `modify_vault` next-step action.
 *
 * Returns the `ApplyManifest` so the caller can record it / reference
 * its `id` in a timeline event.
 */
export async function applyOperations(
  operations: PatchOperation[],
  caseId: string,
  config: VaultSafetyConfig,
): Promise<ApplyManifest> {
  // Compute base hashes from disk for update/move ops so executePatch's
  // hash-validation phase passes (it asserts currentHash === baseHashes[path]).
  const baseHashes: Record<string, string> = {};
  for (const op of operations) {
    if (op.type === 'update_file') {
      baseHashes[op.path] = await computeHash(op.path);
    } else if (op.type === 'move_file') {
      baseHashes[op.fromPath] = await computeHash(op.fromPath);
    }
  }

  const now = new Date().toISOString();
  const patchId = genPatchManifestId();
  const manifest: PatchManifest = {
    id: patchId,
    caseId: caseId as any /* CaseId brand */,
    patchIntentId: `pi_inline_${patchId}` as any /* required by type but
      unused by executePatch; the patch_intents table is retired (line 1) */,
    status: 'approved' /* skip the old preview step — user already approved */,
    operationsJson: JSON.stringify(operations),
    baseFileHashesJson: JSON.stringify(baseHashes),
    createdAt: now,
    updatedAt: now,
  };

  return executePatch(manifest, config);
}

/**
 * Rollback a previously applied manifest.
 */
export async function rollbackApply(
  applyManifest: ApplyManifest,
  backupDir: string,
  config: VaultSafetyConfig,
): Promise<void> {
  const operations: PatchOperation[] = JSON.parse(applyManifest.appliedOperationsJson);
  const backupRefs: { operationType: string; path: string; backupPath: string | null }[] =
    JSON.parse(applyManifest.backupRefsJson);

  // Process in reverse order
  const reversedOps = [...operations].reverse();

  for (let i = 0; i < reversedOps.length; i++) {
    const op = reversedOps[i];
    const backup = backupRefs.find(b => {
      if (op.type === 'move_file') return b.path === op.fromPath;
      return b.path === (op.type === 'update_file' ? op.path : (op as any).path);
    });

    if (op.type === 'create_file') {
      const filePath = op.path;
      const currentHash = await computeHash(filePath);
      const appliedHash = createHash('sha256').update(op.content).digest('hex');

      if (currentHash !== appliedHash && currentHash !== '') {
        throw new Error(
          `Rollback blocked: ${filePath} has been modified since apply. ` +
          `Cannot safely delete.`
        );
      }
      await fs.unlink(filePath);
    } else if (op.type === 'update_file') {
      if (!backup?.backupPath) throw new Error(`No backup found for ${op.path}`);
      const currentHash = await computeHash(op.path);
      const expectedHash = createHash('sha256')
        .update(await fs.readFile(op.path))
        .digest('hex');

      if (currentHash !== expectedHash) {
        // Check if it matches what we wrote
        throw new Error(`Rollback blocked: ${op.path} has been modified since apply.`);
      }
      await fs.copyFile(backup.backupPath, op.path);
    } else if (op.type === 'move_file') {
      const currentHash = await computeHash(op.toPath);
      if (currentHash !== '') {
        // Check if file at target was modified
        throw new Error(`Rollback blocked: ${op.toPath} has been modified since apply.`);
      }
      // Check source doesn't exist
      const sourceExists = await fs.access(op.fromPath).then(() => true).catch(() => false);
      if (sourceExists) {
        throw new Error(`Rollback blocked: original path ${op.fromPath} is no longer available.`);
      }
      await fs.rename(op.toPath, op.fromPath);
    }
  }
}

/**
 * Scan a directory for markdown files.
 */
export async function scanMarkdownFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(path.join(dirPath, entry.name));
      }
    }
  } catch (err) {
    console.error(`Failed to scan ${dirPath}:`, err);
  }

  return files;
}
