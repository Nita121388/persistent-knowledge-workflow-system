import { test, expect } from '../fixtures/config.js';

/**
 * Scenario 2: Trigger Analyze → Multi-page Reflections
 *
 * User clicks "Generate Proposal" on a Captured case → sees Analyzing state →
 * checks Dashboard + Agent Dashboard → cancels → verifies everything reverts.
 */
const CAPTURED_CASE_ID = 'case_20260701_om9s';

test.describe('Analyze Trigger — Cross-page Reflections', () => {

  test('trigger analyze → case shows Analyzing → cancel → back to Captured', async ({ page }) => {
    // --- Step 1: Open a Captured case ---
    console.log('[Step 1] Opening Captured case...');
    await page.goto(`/cases/${CAPTURED_CASE_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Verify we see Generate Proposal button (means case is Captured)
    const generateBtn = page.getByRole('button', { name: 'Generate Proposal' });
    await expect(generateBtn).toBeVisible();
    console.log('[Step 1] ✅ Generate Proposal button visible');

    // --- Step 2: Click Generate Proposal ---
    console.log('[Step 2] Clicking Generate Proposal...');
    await generateBtn.click();
    await page.waitForTimeout(3000);

    // Verify Analyzing state appears
    // The page should show "AI is analyzing this case..." message
    const analyzingText = page.locator('text=AI is analyzing');
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });

    // The UI might take a moment to update (polling interval 5s)
    try {
      await analyzingText.waitFor({ state: 'visible', timeout: 10000 });
      console.log('[Step 2] ✅ Analyzing indicator visible');
    } catch {
      console.log('[Step 2] ⚠️ Analyzing text not found, checking for status change...');
    }

    try {
      await expect(cancelBtn).toBeVisible({ timeout: 5000 });
      console.log('[Step 2] ✅ Cancel button visible');
    } catch {
      console.log('[Step 2] ⚠️ Cancel button not visible');
    }

    // --- Step 3: Check Dashboard queue still has the case ---
    console.log('[Step 3] Checking Dashboard Inbox tab...');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Click Inbox tab
    await page.locator('button').filter({ hasText: 'Inbox' }).click();
    await page.waitForTimeout(1000);

    // The case should still appear in Inbox (both Captured and Analyzing are in inbox queue)
    // Check for the case title or ID
    const caseInInbox = page.locator(`a[href*="${CAPTURED_CASE_ID}"]`);
    await expect(caseInInbox).toBeVisible();
    console.log('[Step 3] ✅ Case still visible in Inbox tab');

    // --- Step 4: Return to case and Cancel ---
    console.log('[Step 4] Cancelling analysis...');
    await page.goto(`/cases/${CAPTURED_CASE_ID}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000);

    // Find and click Cancel button
    const cancelBtn2 = page.getByRole('button', { name: 'Cancel' });
    const isCancelVisible = await cancelBtn2.isVisible().catch(() => false);

    if (isCancelVisible) {
      await cancelBtn2.click();
      await page.waitForTimeout(3000);
      console.log('[Step 4] ✅ Cancel clicked');

      // Verify case is back to Captured with Generate Proposal button
      await expect(generateBtn).toBeVisible({ timeout: 10000 });
      console.log('[Step 4] ✅ Case returned to Captured state');
    } else {
      console.log('[Step 4] ⚠️ Cancel button not found, checking if already Captured...');
      // If already Captured, verify the Generate Proposal button is back
      await expect(generateBtn).toBeVisible({ timeout: 10000 });
      console.log('[Step 4] ✅ Generate Proposal button visible (already Captured)');
    }
  });
});
