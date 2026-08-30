/**
 * Layer 16 — E2E: Core loop
 * Home → recommendation → draft → workspace → approve all → export
 *
 * Requires: pnpm playwright test (configured in playwright.config.ts)
 * Run against: http://localhost:3000 (start with `pnpm dev`)
 */
import { test, expect } from "@playwright/test";

const BASE_URL = process.env.TEST_BASE_URL ?? "http://localhost:3000";

test.describe("Core loop — anonymous user", () => {
  test("completes home → recommendation → workspace without sign-in", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/home`);

    // Home screen loads.
    await expect(page.getByRole("main")).toBeVisible();

    // Type a situation into the TED input.
    const input = page.getByRole("textbox", { name: /tell ted/i });
    await input.fill("I need to write a resume for a marketing manager role.");
    await input.press("Enter");

    // TED responds or recommends a template.
    await expect(page.getByText(/resume/i)).toBeVisible({ timeout: 15_000 });
  });

  test("workspace renders sections for the chosen template", async ({
    page,
  }) => {
    // Navigate to a workspace with a seeded outcome.
    await page.goto(`${BASE_URL}/outcomes/test-outcome-id`);

    // The section editor should be visible.
    await expect(
      page.getByRole("region", { name: /workspace/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("approve all sections enables the export button", async ({ page }) => {
    await page.goto(`${BASE_URL}/outcomes/test-outcome-id`);

    // Approve each section.
    const approveButtons = page.getByRole("button", { name: /approve/i });
    const count = await approveButtons.count();
    for (let i = 0; i < count; i++) {
      await approveButtons.nth(i).click();
    }

    // Export button becomes active.
    await expect(
      page.getByRole("button", { name: /export/i }),
    ).not.toBeDisabled({ timeout: 5_000 });
  });
});

test.describe("Core loop — auth gating", () => {
  test("AuthModal appears on export attempt by anonymous user", async ({
    page,
  }) => {
    await page.goto(`${BASE_URL}/outcomes/test-outcome-id`);

    // Try to export without being signed in.
    const exportBtn = page.getByRole("button", { name: /export/i });
    await exportBtn.click();

    await expect(
      page.getByRole("dialog", { name: /sign (in|up)/i }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
