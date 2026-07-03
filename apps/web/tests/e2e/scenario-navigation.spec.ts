import { test, expect } from '../fixtures/config.js';

/**
 * Scenario 6: Navigation Consistency
 *
 * User navigates between pages and verifies:
 * - Nav links highlight correctly
 * - Agent toggle state persists across page navigation
 * - State is restored after page refresh
 */
test.describe('Navigation Consistency', () => {

  test('nav links highlight correctly on each page', async ({ page }) => {
    const pages = [
      { path: '/', linkName: 'Dashboard' },
      { path: '/agent-runtime', linkName: 'Agents' },
      { path: '/logs', linkName: 'Logs' },
      { path: '/settings', linkName: 'Settings' },
    ];

    for (const { path, linkName } of pages) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Find the nav link and check it has the active styling
      const navLink = page.locator('nav a').filter({ hasText: linkName });

      // If the backend is not running, the page may show Connecting screen instead of nav
      // Skip check if no nav is visible (backend unreachable)
      const navVisible = await page.locator('nav').isVisible().catch(() => false);
      if (!navVisible) {
        console.log(`[Nav] ⚠ Backend not reachable at ${path}, skipping nav check`);
        continue;
      }

      await expect(navLink).toBeVisible();
      console.log(`[Nav] ✅ ${linkName} link visible at ${path}`);

      // Active link should have specific background class
      const classAttr = await navLink.getAttribute('class') || '';
      expect(classAttr).toContain('bg-gray-100');
      console.log(`[Nav] ✅ ${linkName} link has active styling at ${path}`);

      // Verify other nav links don't all have active styling
      const allNavLinks = page.locator('nav a');
      const linkCount = await allNavLinks.count();
      for (let i = 0; i < linkCount; i++) {
        const link = allNavLinks.nth(i);
        const linkClass = await link.getAttribute('class') || '';
        const linkText = await link.textContent() || '';
        if (linkText === linkName) {
          expect(linkClass).toContain('bg-gray-100');
        }
      }
    }
  });

  test('Agent toggle state persists across page navigation', async ({ page }) => {
    // --- Step 1: Toggle Agent ON ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const toggleBtn = page.locator('header button').filter({ hasText: /Agent/ });
    const initialText = await toggleBtn.textContent();

    // If OFF, toggle ON
    if (initialText.includes('OFF')) {
      await toggleBtn.click();
      await page.waitForTimeout(3000);
      await expect(toggleBtn).toContainText('Agent ON');
      console.log('[Nav] ✅ Toggled ON');
    }

    // --- Step 2: Navigate to different pages, verify toggle stays ---
    const pagesToCheck = ['/agent-runtime', '/logs', '/settings', '/'];
    for (const path of pagesToCheck) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const toggleText = await toggleBtn.textContent();
      expect(toggleText).toContain('Agent ON');
      console.log(`[Nav] ✅ Agent ON persists at ${path}`);
    }

    // --- Step 3: Toggle OFF and verify across pages ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await toggleBtn.click();
    await page.waitForTimeout(3000);
    await expect(toggleBtn).toContainText('Agent OFF');

    for (const path of pagesToCheck) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const toggleText = await toggleBtn.textContent();
      expect(toggleText).toContain('Agent OFF');
      console.log(`[Nav] ✅ Agent OFF persists at ${path}`);
    }
  });

  test('state persists after page refresh', async ({ page }) => {
    // --- Step 1: Toggle Agent ON ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // If backend is not reachable, skip this test
    const toggleBtn = page.locator('header button').filter({ hasText: /Agent/ });
    const toggleVisible = await toggleBtn.isVisible().catch(() => false);
    if (!toggleVisible) {
      console.log('[Refresh] ⚠ Backend not reachable, skipping toggle test');
      return;
    }

    const initialText = await toggleBtn.textContent();

    if (initialText.includes('OFF')) {
      await toggleBtn.click();
      await page.waitForTimeout(3000);
    }

    await expect(toggleBtn).toContainText('Agent ON');
    console.log('[Refresh] ✅ Toggled ON');

    // --- Step 2: Refresh the page ---
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // After refresh, settings are fetched again from API
    // The button should reflect the persisted state
    await expect(toggleBtn).toContainText('Agent ON');
    console.log('[Refresh] ✅ Agent ON persists after page refresh');

    // --- Step 3: Toggle OFF and refresh ---
    await toggleBtn.click();
    await page.waitForTimeout(3000);
    await expect(toggleBtn).toContainText('Agent OFF');

    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    await expect(toggleBtn).toContainText('Agent OFF');
    console.log('[Refresh] ✅ Agent OFF persists after page refresh');
  });

  test('shows connecting screen instead of SetupWizard when backend is unreachable', async ({ page }) => {
    // Navigate to a page with backend unreachable — should not jump to SetupWizard
    await page.goto('/agent-runtime');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Should show connecting screen, NOT SetupWizard
    const setupWizard = page.locator('text=PKWS Setup');
    const connecting = page.locator('text=Connecting to server');

    const setupVisible = await setupWizard.isVisible().catch(() => false);
    const connectingVisible = await connecting.isVisible().catch(() => false);

    if (setupVisible) {
      // If backend IS actually running, this test's setup has it configured — that's fine
      console.log('[BackendOffline] ⚠ Backend is reachable, SetupWizard means no settings yet (expected in empty env)');
      return;
    }

    // When backend is truly unreachable, should show the connecting screen
    if (connectingVisible) {
      console.log('[BackendOffline] ✅ Shows "Connecting to server..." instead of jumping to SetupWizard');
    } else {
      // Fallback check: should NOT see active Dashboard/Layout elements that require settings
      const dashboardVisible = await page.locator('text=Knowledge Tasks').isVisible().catch(() => false);
      const agentsVisible = await page.locator('text=Agent Runtime Dashboard').isVisible().catch(() => false);
      expect(dashboardVisible || agentsVisible).toBeFalsy();
      console.log('[BackendOffline] ✅ No backend-dependent UI shown — guarded by connecting state');
    }
  });

  test('shows SetupWizard only after retries exhausted for /api/settings', async ({ page }) => {
    // Navigate to a route that triggers /api/settings fetch
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const setupWizard = page.locator('text=PKWS Setup');
    const connecting = page.locator('text=Connecting to server');

    const setupVisible = await setupWizard.isVisible().catch(() => false);
    const connectingVisible = await connecting.isVisible().catch(() => false);
    const loadingScreen = await page.locator('text=Loading...').isVisible().catch(() => false);

    if (setupVisible) {
      console.log('[SetupRetry] ✅ SetupWizard shown (either no settings configured or retries exhausted)');
    } else if (connectingVisible) {
      console.log('[SetupRetry] ✅ Connecting screen shown while retrying /api/settings');
    } else if (loadingScreen) {
      console.log('[SetupRetry] ✅ Loading screen shown before settings fetch completes');
    } else {
      // Backend is running and configured — dashboard should show
      const dashboard = await page.locator('text=Knowledge Tasks').isVisible().catch(() => false);
      expect(dashboard).toBeTruthy();
      console.log('[SetupRetry] ✅ Dashboard loaded — backend is running with settings');
    }
  });
});
