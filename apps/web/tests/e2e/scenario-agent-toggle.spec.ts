import { test, expect } from '../fixtures/config.js';

/**
 * Scenario 1+4: Agent Runtime Toggle — Cross-page Consistency
 *
 * User clicks the Agent ON/OFF toggle in the header bar,
 * then navigates to Settings and Agent Dashboard to verify
 * the state is reflected everywhere.
 */
test.describe('Agent Runtime Toggle — Cross-page Consistency', () => {

  test('toggle ON → header changes → Settings sync → Dashboard sync → toggle OFF', async ({ page }) => {
    // --- Step 1: Start on Dashboard, find toggle button ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // let settings load

    // Verify initial state is OFF
    const toggleBtn = page.locator('header button').filter({ hasText: /Agent/ });
    await expect(toggleBtn).toContainText('Agent OFF');

    // --- Step 2: Click toggle ON ---
    console.log('[Step 2] Clicking toggle to enable Agent Runtime');
    await toggleBtn.click();

    // Wait for the API call to finish and UI to update
    // The mutation invalidates 'settings', so the next poll will fetch new data
    // refetchInterval is 10s, so wait up to 12s
    await page.waitForTimeout(3000);

    // Check the button shows ON
    await expect(toggleBtn).toContainText('Agent ON');
    console.log('[Step 2] ✅ Header shows Agent ON');

    // --- Step 3: Navigate to Settings → Agent tab ---
    console.log('[Step 3] Verifying Settings Agent tab sync...');
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click the Agent tab
    await page.getByRole('button', { name: 'Agent' }).click();
    await page.waitForTimeout(1000);

    // Verify the Enabled status is shown
    const agentStatus = page.locator('text=Enabled');
    await expect(agentStatus).toBeVisible();
    console.log('[Step 3] ✅ Settings Agent tab shows Enabled');

    // --- Step 4: Navigate to Agent Runtime Dashboard ---
    console.log('[Step 4] Verifying Agent Dashboard sync...');
    await page.goto('/agent-runtime');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check Status card shows Running
    await expect(page.locator('text=Running')).toBeVisible();
    console.log('[Step 4] ✅ Agent Dashboard shows Running');

    // --- Step 5: Navigate back to Dashboard and toggle OFF ---
    console.log('[Step 5] Toggling Agent Runtime OFF...');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click toggle again
    await toggleBtn.click();
    await page.waitForTimeout(3000);

    // Verify OFF
    await expect(toggleBtn).toContainText('Agent OFF');
    console.log('[Step 5] ✅ Header shows Agent OFF');

    // --- Step 6: Verify Settings and Dashboard also reflected ---
    console.log('[Step 6] Verifying all pages reflect OFF...');
    await page.goto('/settings');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Agent' }).click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Disabled')).toBeVisible();
    console.log('[Step 6] ✅ Settings shows Disabled');

    await page.goto('/agent-runtime');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);
    await expect(page.locator('text=Stopped')).toBeVisible();
    console.log('[Step 6] ✅ Agent Dashboard shows Stopped');
  });

  test('rapid double toggle does not break state', async ({ page }) => {
    // Test that clicking toggle 3 times in quick succession
    // leaves the system in a consistent state
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const toggleBtn = page.locator('header button').filter({ hasText: /Agent/ });

    // Get initial state
    const initialText = await toggleBtn.textContent();
    const targetState = initialText.includes('OFF') ? 'ON' : 'OFF';

    // Click rapidly 3 times
    for (let i = 0; i < 3; i++) {
      await toggleBtn.click({ force: true });
      await page.waitForTimeout(500);
    }

    // Wait for final state to settle
    await page.waitForTimeout(5000);

    // Verify the final state is consistent across pages
    const finalHeaderText = await toggleBtn.textContent();
    console.log(`[RapidToggle] Initial: ${initialText.trim()}, Final: ${finalHeaderText.trim()}`);

    // Check Agent Dashboard
    await page.goto('/agent-runtime');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const running = await page.locator('text=Running').isVisible().catch(() => false);
    const stopped = await page.locator('text=Stopped').isVisible().catch(() => false);

    // Header and Dashboard should agree
    if (finalHeaderText.includes('ON')) {
      expect(running).toBeTruthy();
      console.log('[RapidToggle] ✅ Header says ON, Dashboard says Running');
    } else {
      expect(stopped).toBeTruthy();
      console.log('[RapidToggle] ✅ Header says OFF, Dashboard says Stopped');
    }
  });
});
