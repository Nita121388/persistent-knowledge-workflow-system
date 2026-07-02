import { expect, test } from '../fixtures/config';

test.describe('Agent Runtime Dashboard', () => {
  test('should show navigation link to Agents page', async ({ page, setupSystem }) => {
    await setupSystem(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Nav should have Agents link
    const agentsLink = page.locator('a:has-text("Agents")');
    await expect(agentsLink).toBeVisible({ timeout: 5000 });
  });

  test('should load Agent Runtime Dashboard with status cards', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/agent-runtime');
    await page.waitForLoadState('networkidle');

    // Dashboard title
    await expect(page.locator('text=Agent Runtime Dashboard')).toBeVisible({ timeout: 10000 });

    // Status cards should be present
    await expect(page.locator('text=Status').first()).toBeVisible();
    await expect(page.locator('text=Active Sessions')).toBeVisible();
    await expect(page.locator('text=Pending')).toBeVisible();
    await expect(page.locator('text=Waiting')).toBeVisible();
  });

  test('should have Overview and Sessions tabs', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/agent-runtime');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('button:has-text("Overview")')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button:has-text("Sessions")')).toBeVisible();

    // Switch to Sessions tab
    await page.locator('button:has-text("Sessions")').click();
    await page.waitForTimeout(300);

    // Should show session list (even if empty)
    await expect(page.locator('text=No active sessions')).toBeVisible({ timeout: 3000 });
  });

  test('should connect to WebSocket for live events', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/agent-runtime');
    await page.waitForLoadState('networkidle');

    // Wait for WebSocket connection indicator
    // The green dot appears when ws is connected
    await page.waitForTimeout(2000);
    const wsIndicator = page.locator('text=Live');
    await expect(wsIndicator).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Agent Runtime Settings', () => {
  test('should show Agent tab in Settings', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Agent tab should be visible
    const agentTab = page.locator('button:has-text("Agent")');
    await expect(agentTab).toBeVisible({ timeout: 5000 });
  });

  test('should show sandbox mode options in Agent settings', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Click Agent tab
    await page.locator('button:has-text("Agent")').click();
    await page.waitForTimeout(300);

    // Sandbox mode section
    await expect(page.locator('text=Sandbox Mode')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Workspace Only')).toBeVisible();
    await expect(page.locator('text=Vault Read-Only')).toBeVisible();
    await expect(page.locator('text=Full Access')).toBeVisible();

    // Default should be workspace-only
    const workspaceRadio = page.locator('input[value="workspace-only"]');
    await expect(workspaceRadio).toBeChecked();
  });

  test('should show available agents list', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await page.locator('button:has-text("Agent")').click();
    await page.waitForTimeout(300);

    // Should show Available Agents section or the "not detected" message
    const noAgents = page.locator('text=No CLI agents detected');
    const codexAgent = page.locator('text=Codex CLI');
    const claudeAgent = page.locator('text=Claude Code');

    // At least one should be visible
    const anyVisible = await Promise.any([
      noAgents.isVisible().then(v => v),
      codexAgent.isVisible().then(v => v),
      claudeAgent.isVisible().then(v => v),
    ]);
    expect(anyVisible).toBeTruthy();
  });
});
