import { defineConfig } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Load local config if exists
let localConfig: Record<string, any> = {};
const localConfigPath = resolve(process.cwd(), 'e2e.local.json');
if (existsSync(localConfigPath)) {
  try {
    localConfig = JSON.parse(readFileSync(localConfigPath, 'utf-8'));
  } catch {
    console.warn('Failed to parse e2e.local.json, using defaults');
  }
}

const BASE_URL = process.env.E2E_BASE_URL || localConfig.baseUrl || 'http://127.0.0.1:5174';
const VIEWPORTS = (process.env.E2E_VIEWPORTS || localConfig.viewports || 'desktop-1280').split(',').map(v => v.trim()).filter(Boolean);
const PAGE_TIMEOUT = Number(process.env.E2E_PAGE_TIMEOUT || localConfig.pageTimeout || 30000);
const TEST_TIMEOUT = Number(process.env.E2E_TEST_TIMEOUT || localConfig.testTimeout || 120000);
const HEADED = process.env.E2E_HEADED === '1' || localConfig.headed === true;

const viewportMap: Record<string, { width: number; height: number }> = {
  'desktop-1280': { width: 1280, height: 720 },
  'desktop-1440': { width: 1440, height: 900 },
  'tablet-768': { width: 768, height: 1024 },
  'tablet-1024': { width: 1024, height: 768 },
  'mobile-390': { width: 390, height: 844 },
};

// Generate projects from viewports
const projects = VIEWPORTS.map(name => {
  const viewport = viewportMap[name] || { width: 1280, height: 720 };
  return {
    name,
    use: {
      baseURL: BASE_URL,
      viewport,
      actionTimeout: PAGE_TIMEOUT,
      navigationTimeout: PAGE_TIMEOUT,
    },
  };
});

// Default project if no viewports specified
if (projects.length === 0) {
  projects.push({
    name: 'default',
    use: {
      baseURL: BASE_URL,
      viewport: { width: 1280, height: 720 },
      actionTimeout: PAGE_TIMEOUT,
      navigationTimeout: PAGE_TIMEOUT,
    },
  });
}

export default defineConfig({
  testDir: './tests/e2e',
  timeout: TEST_TIMEOUT,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['list'],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects,
});
