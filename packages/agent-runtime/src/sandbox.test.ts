import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { prepareSandboxedContext } from './cli-runner.js';

describe('sandbox — prepareSandboxedContext', () => {
  let tmpDir: string;
  let vaultDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkws-sandbox-test-'));
    vaultDir = path.join(tmpDir, 'vault');
    fs.mkdirSync(path.join(vaultDir, 'subdir'), { recursive: true });

    // Create test vault files
    fs.writeFileSync(path.join(vaultDir, 'note1.md'), '# Note 1');
    fs.writeFileSync(path.join(vaultDir, 'note2.md'), '# Note 2');
    fs.writeFileSync(path.join(vaultDir, 'image.png'), 'fake-png');
    fs.writeFileSync(path.join(vaultDir, 'subdir', 'deep-note.md'), '# Deep note');
    fs.writeFileSync(path.join(vaultDir, 'subdir', 'data.json'), '{}');

    // Hidden file
    fs.writeFileSync(path.join(vaultDir, '.secret.md'), '# Secret');
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('workspace-only mode', () => {
    it('should not create context/vault directory', () => {
      const workDir = path.join(tmpDir, 'work-wo');
      fs.mkdirSync(workDir, { recursive: true });

      prepareSandboxedContext('workspace-only', workDir, vaultDir);

      const vaultContextDir = path.join(workDir, 'context', 'vault');
      expect(fs.existsSync(vaultContextDir)).toBe(false);
    });
  });

  describe('vault-readonly mode', () => {
    it('should copy vault markdown files to context/vault/', () => {
      const workDir = path.join(tmpDir, 'work-vr');
      fs.mkdirSync(workDir, { recursive: true });

      prepareSandboxedContext('vault-readonly', workDir, vaultDir);

      const vaultContextDir = path.join(workDir, 'context', 'vault');
      expect(fs.existsSync(vaultContextDir)).toBe(true);

      // Should have .md files
      expect(fs.existsSync(path.join(vaultContextDir, 'note1.md'))).toBe(true);
      expect(fs.existsSync(path.join(vaultContextDir, 'note2.md'))).toBe(true);

      // Should have subdir contents
      expect(fs.existsSync(path.join(vaultContextDir, 'subdir', 'deep-note.md'))).toBe(true);

      // Should NOT copy non-.md files
      expect(fs.existsSync(path.join(vaultContextDir, 'image.png'))).toBe(false);
      expect(fs.existsSync(path.join(vaultContextDir, 'subdir', 'data.json'))).toBe(false);
    });

    it('should handle missing vault path gracefully', () => {
      const workDir = path.join(tmpDir, 'work-vr-missing');
      fs.mkdirSync(workDir, { recursive: true });

      // Should not throw
      expect(() => {
        prepareSandboxedContext('vault-readonly', workDir, '/nonexistent/path');
      }).not.toThrow();
    });
  });

  describe('full mode', () => {
    it('should not create context directory', () => {
      const workDir = path.join(tmpDir, 'work-full');
      fs.mkdirSync(workDir, { recursive: true });

      prepareSandboxedContext('full', workDir);

      const contextDir = path.join(workDir, 'context');
      expect(fs.existsSync(contextDir)).toBe(false);
    });
  });
});
