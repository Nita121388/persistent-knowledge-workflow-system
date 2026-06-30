import { test as base, expect, Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load local config
let localConfig: Record<string, any> = {};
const localConfigPath = resolve(process.cwd(), 'e2e.local.json');
if (existsSync(localConfigPath)) {
  try {
    localConfig = JSON.parse(readFileSync(localConfigPath, 'utf-8'));
  } catch {
    // ignore
  }
}

export const VAULT_PATH = process.env.E2E_VAULT_PATH || localConfig.vaultPath || '';
export const INBOX_PATH = process.env.E2E_INBOX_PATH || localConfig.inboxPath || '';
export const WORKSPACE_PATH = process.env.E2E_WORKSPACE_PATH || localConfig.workspacePath || '';
export const AI_API_KEY = process.env.E2E_AI_API_KEY || localConfig.aiApiKey || '';
export const AI_BASE_URL = process.env.E2E_AI_BASE_URL || localConfig.aiBaseUrl || 'https://api.openai.com/v1';
export const AI_MODEL = process.env.E2E_AI_MODEL || localConfig.aiDefaultModel || 'gpt-4.1-mini';
export const REPEAT = Number(process.env.E2E_REPEAT || localConfig.repeat || 1);

type TestConfig = {
  fillInput: (page: Page, placeholder: string, value: string) => Promise<void>;
  waitForApiReady: (page: Page) => Promise<void>;
  setupSystem: (page: Page) => Promise<void>;
};

const fillInput = async (page: Page, placeholder: string, value: string) => {
  const input = page.locator(`input[placeholder="${placeholder}"]`);
  await input.waitFor({ state: 'visible', timeout: 10000 });
  await input.fill(value);
};

const waitForApiReady = async (page: Page) => {
  // Wait for the page to load and show either Dashboard or SetupWizard
  await page.waitForLoadState('networkidle');
  // Check if we can reach the backend
  const response = await page.evaluate(async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      return data;
    } catch {
      return { ok: false };
    }
  });
  return response;
};

const setupSystem = async (page: Page) => {
  // Go to app root — should show SetupWizard if not configured
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Check if we are on setup wizard (look for the title)
  const setupTitle = page.locator('text=PKWS Setup');
  if (await setupTitle.isVisible({ timeout: 3000 }).catch(() => false)) {
    // Fill vault path
    if (VAULT_PATH) {
      const vaultInputs = page.locator('input[placeholder="/path/to/obsidian/vault"]');
      if (await vaultInputs.count() > 0) {
        await vaultInputs.fill(VAULT_PATH);
      }
    }
    if (INBOX_PATH) {
      const inboxInputs = page.locator('input[placeholder="/path/to/vault/inbox"]');
      if (await inboxInputs.count() > 0) {
        await inboxInputs.fill(INBOX_PATH);
      }
    }
    if (WORKSPACE_PATH) {
      const wsInputs = page.locator('input[placeholder="/path/to/pkws-workspace"]');
      if (await wsInputs.count() > 0) {
        await wsInputs.fill(WORKSPACE_PATH);
      }
    }

    // Click Continue
    const continueBtn = page.locator('button:has-text("Continue")');
    if (await continueBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(500);

      // Step 2: AI config
      const baseUrlInput = page.locator('input[type="password"]').first();
      if (await baseUrlInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        // We're on step 2, fill AI details
        // Just put dummy values for test
        const apiKeyInput = page.locator('input[type="password"]');
        if (await apiKeyInput.isVisible({ timeout: 1000 }).catch(() => false)) {
          await apiKeyInput.fill(AI_API_KEY || 'sk-test-dummy-key');
        }
        // Click Test & Continue
        const testBtn = page.locator('button:has-text("Test & Continue")');
        if (await testBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await testBtn.click();
          await page.waitForTimeout(1000);
        }
      }

      // Step 3: Save
      const saveBtn = page.locator('button:has-text("Save & Start")');
      if (await saveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await saveBtn.click();
        await page.waitForURL('**/');
      }
    }
  }
};

export const test = base.extend<TestConfig>({
  fillInput: async ({}, use) => {
    await use(fillInput);
  },
  waitForApiReady: async ({}, use) => {
    await use(waitForApiReady);
  },
  setupSystem: async ({}, use) => {
    await use(setupSystem);
  },
});

export { expect };
