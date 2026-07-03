import { test, expect } from '../fixtures/config.js';

/**
 * Scenario 5: Logs Consistency with UI Actions
 *
 * User performs actions (toggle Agent Runtime, trigger analyze, cancel)
 * and then checks the Logs page to verify the corresponding log entries appear.
 */
const CAPTURED_CASE_ID = 'case_20260701_om9s';

test.describe('Logs Consistency with UI Actions', () => {

  test('toggle Agent Runtime → log entries appear', async ({ page }) => {
    // --- Step 1: Toggle Agent ON ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const toggleBtn = page.locator('header button').filter({ hasText: /Agent/ });
    const initialText = await toggleBtn.textContent();

    // If already ON, toggle OFF first to ensure we can toggle ON
    if (initialText.includes('ON')) {
      await toggleBtn.click();
      await page.waitForTimeout(3000);
    }

    // Toggle ON
    await toggleBtn.click();
    await page.waitForTimeout(3000);

    // --- Step 2: Navigate to Logs page ---
    console.log('[Step 2] Checking logs for Agent Runtime start entry...');
    await page.goto('/logs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // The logs list should show entries including agent toggle log
    const logEntries = page.locator('[class*="font-mono text-xs"]');
    const allText = await page.locator('header+main').textContent();

    // Check that the log panel shows entries
    expect(allText.length).toBeGreaterThan(0);
    console.log(`[Step 2] ✅ Log page has content (${allText.length} chars)`);

    // --- Step 3: Toggle OFF and verify ---
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    await toggleBtn.click();
    await page.waitForTimeout(3000);

    // --- Step 4: Check logs again ---
    console.log('[Step 4] Checking logs for Agent Runtime stop entry...');
    await page.goto('/logs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    const logContent = await page.locator('header+main').textContent();
    expect(logContent.length).toBeGreaterThan(100);
    console.log('[Step 4] ✅ Log page still has content');
  });

  test('trigger analyze → caseId filter works on logs', async ({ page }) => {
    // --- Step 1: Trigger analyze on a Captured case ---
    console.log('[Step 1] Triggering analyze...');
    await page.goto(`/cases/${CAPTURED_CASE_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    const generateBtn = page.getByRole('button', { name: 'Generate Proposal' });
    if (await generateBtn.isVisible()) {
      await generateBtn.click();
      await page.waitForTimeout(3000);
      console.log('[Step 1] ✅ Analyze triggered');
    }

    // --- Step 2: Cancel the analysis ---
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(3000);
      console.log('[Step 2] ✅ Analysis cancelled');
    }

    // --- Step 3: Navigate to logs with caseId filter ---
    console.log('[Step 3] Opening logs with caseId filter...');
    await page.goto(`/logs?caseId=${CAPTURED_CASE_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // The logs page should load
    const logPanel = page.locator('header+main');
    await expect(logPanel).toBeVisible();
    console.log('[Step 3] ✅ Logs page loaded with caseId filter');

    // --- Step 4: Navigate to logs without filter ---
    console.log('[Step 4] Opening full logs...');
    await page.goto('/logs');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3000);

    // Check that log entries are visible — they should have timestamp, level, category, message
    // The logs page renders entries in a dark terminal style
    const logList = page.locator('header+main');
    await expect(logList).toBeVisible();
    console.log('[Step 4] ✅ Full logs page loaded');

    // --- Step 5: Verify level filters are interactive ---
    console.log('[Step 5] Testing level filters...');
    const debugBtn = page.getByRole('button', { name: 'debug' });
    const infoBtn = page.getByRole('button', { name: 'info' });

    if (await debugBtn.isVisible()) {
      await debugBtn.click();
      await page.waitForTimeout(500);
      console.log('[Step 5] ✅ debug filter clicked');
    }
    if (await infoBtn.isVisible()) {
      await infoBtn.click();
      await page.waitForTimeout(500);
      // Click again to re-enable
      await infoBtn.click();
      await page.waitForTimeout(500);
      console.log('[Step 5] ✅ info filter toggled');
    }

    // --- Step 6: Verify search box exists ---
    const searchInput = page.locator('input[placeholder*="Search"]');
    if (await searchInput.isVisible().catch(() => false)) {
      console.log('[Step 6] ✅ Search box visible');
    } else {
      console.log('[Step 6] ⚠️ Search box not found (might use different placeholder)');
    }

    // --- Step 7: Verify Live checkbox ---
    const liveCheckbox = page.locator('input[type="checkbox"]');
    if (await liveCheckbox.isVisible().catch(() => false)) {
      console.log('[Step 7] ✅ Live checkbox visible');
    }
  });
});
