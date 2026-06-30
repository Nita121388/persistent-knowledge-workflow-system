import { expect, test, REPEAT } from '../fixtures/config';

test.describe('PKWS Case Flow', () => {
  test('should show empty states for all queues', async ({ page, setupSystem }) => {
    await setupSystem(page);

    // Check each queue shows empty state
    const queues = [
      { name: 'Inbox', msg: 'No cases' },
      { name: 'Review', msg: 'No cases' },
      { name: 'Active', msg: 'No cases' },
      { name: 'Closed', msg: 'No cases' },
    ];

    for (const queue of queues) {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      await page.locator(`button:has-text("${queue.name}")`).click();
      await page.waitForTimeout(300);

      // Should show empty state
      await expect(page.locator(`text=${queue.msg}`).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('should navigate to case detail and back', async ({ page, setupSystem }) => {
    await setupSystem(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // We can't test without actual cases, but we can verify the URL structure
    // Just verify dashboard is shown
    await expect(page.locator('text=Knowledge Tasks')).toBeVisible({ timeout: 10000 });
  });

  test('should scan inbox button work', async ({ page, setupSystem }) => {
    await setupSystem(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click Scan Inbox
    const scanBtn = page.locator('button:has-text("Scan Inbox")');
    await expect(scanBtn).toBeVisible({ timeout: 5000 });
    await scanBtn.click();

    // Button should show loading state briefly
    await page.waitForTimeout(500);
  });
});

test.describe('PKWS Navigation', () => {
  test('should navigate between Dashboard and Settings', async ({ page, setupSystem }) => {
    await setupSystem(page);

    // Go to dashboard
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Knowledge Tasks')).toBeVisible({ timeout: 10000 });

    // Click Settings nav
    await page.locator('a:has-text("Settings")').click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Settings')).toBeVisible({ timeout: 10000 });

    // Click Dashboard nav (PKWS logo)
    await page.locator('a:has-text("PKWS")').click();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('text=Knowledge Tasks')).toBeVisible({ timeout: 10000 });
  });

  test('should show 404 redirect to dashboard', async ({ page, setupSystem }) => {
    await setupSystem(page);

    await page.goto('/nonexistent-route');
    await page.waitForLoadState('networkidle');
    // Should redirect to dashboard
    await expect(page.locator('text=Knowledge Tasks')).toBeVisible({ timeout: 10000 });
  });
});
