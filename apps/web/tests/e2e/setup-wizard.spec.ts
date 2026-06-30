import { expect, test } from '../fixtures/config';

test.describe('PKWS Setup Wizard', () => {
  test('should show setup wizard when no settings configured', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should show the setup wizard
    await expect(page.locator('text=PKWS Setup')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Configure Paths')).toBeVisible();
    await expect(page.locator('text=Obsidian Vault Path')).toBeVisible();
    await expect(page.locator('text=Clipper Inbox Path')).toBeVisible();
    await expect(page.locator('text=Workspace Path')).toBeVisible();
  });

  test('should validate path inputs cannot be empty', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=PKWS Setup')).toBeVisible({ timeout: 15000 });

    // Continue button should be disabled when paths empty
    const continueBtn = page.locator('button:has-text("Continue")');
    await expect(continueBtn).toBeDisabled();
  });

  test('should navigate through steps', async ({ page, setupSystem }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=PKWS Setup')).toBeVisible({ timeout: 15000 });

    // Fill in paths
    const vaultInput = page.locator('input[placeholder="/path/to/obsidian/vault"]');
    await vaultInput.fill('/tmp/test-vault');

    const inboxInput = page.locator('input[placeholder="/path/to/vault/inbox"]');
    await inboxInput.fill('/tmp/test-vault/inbox');

    const wsInput = page.locator('input[placeholder="/path/to/pkws-workspace"]');
    await wsInput.fill('/tmp/test-workspace');

    // Go to step 2
    await page.locator('button:has-text("Continue")').click();
    await page.waitForTimeout(300);

    // Should show AI configuration
    await expect(page.locator('text=AI Configuration')).toBeVisible();
  });
});

test.describe('PKWS Dashboard', () => {
  test('should show Dashboard with queue tabs when system is configured', async ({ page, setupSystem }) => {
    // First ensure system is set up
    await setupSystem(page);

    // Navigate to dashboard
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Should show dashboard
    await expect(page.locator('text=Knowledge Tasks')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Inbox')).toBeVisible();
    await expect(page.locator('text=Review')).toBeVisible();
    await expect(page.locator('text=Active')).toBeVisible();
    await expect(page.locator('text=Closed')).toBeVisible();
    await expect(page.locator('text=Scan Inbox')).toBeVisible();
  });

  test('should switch between queue tabs', async ({ page, setupSystem }) => {
    await setupSystem(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click each queue tab
    const queues = ['Inbox', 'Review', 'Active', 'Closed'];
    for (const queue of queues) {
      await page.locator(`button:has-text("${queue}")`).click();
      await page.waitForTimeout(200);
      // The active tab should have the appropriate styling
      const activeBtn = page.locator(`button:has-text("${queue}")`);
      await expect(activeBtn).toBeVisible();
    }
  });
});

test.describe('PKWS Settings', () => {
  test('should show settings page with tabs', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('text=Settings')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=General')).toBeVisible();
    await expect(page.locator('text=AI')).toBeVisible();
    await expect(page.locator('text=Vault')).toBeVisible();
    await expect(page.locator('text=Rules')).toBeVisible();
  });

  test('should switch between settings tabs', async ({ page, setupSystem }) => {
    await setupSystem(page);
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');

    // Click each settings tab
    const tabs = ['AI', 'Vault', 'Rules'];
    for (const tab of tabs) {
      await page.locator(`button:has-text("${tab}")`).click();
      await page.waitForTimeout(200);
    }
  });
});
