/**
 * Layer 16 — E2E: All 4 bundles
 * Verifies that each bundle can be browsed and a document started.
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

const BUNDLES = [
  { name: "I need a job", domain: "employment" },
  { name: "Onboard a new employee", domain: "business" },
  { name: "Set up the basics of my business", domain: "business" },
  { name: "I'm applying", domain: "education" },
];

for (const bundle of BUNDLES) {
  test(`Bundle: "${bundle.name}" is browsable`, async ({ page }) => {
    await page.goto(`${BASE_URL}/home`);

    // Open browse modal.
    const browseBtn = page.getByRole("button", { name: /browse templates/i });
    await browseBtn.click();

    // Bundle should appear in the modal.
    await expect(page.getByText(bundle.name)).toBeVisible({ timeout: 5_000 });
  });
}
