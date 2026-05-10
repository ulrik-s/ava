/**
 * Smoke-test: verifierar att kärnflödena renderar utan fel.
 * Tjänar också som mall för ytterligare E2E-tester.
 */

import { test, expect } from "@playwright/test";

test.describe("Smoke", () => {
  test("loginsida laddas och visar rätt rubrik", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "AVA" })).toBeVisible();
    await expect(page.getByRole("button", { name: /logga in/i })).toBeVisible();
  });

  test("startsida i dev-läge laddar dashboarden (auto-inloggad)", async ({ page }) => {
    await page.goto("/");
    // Sidomenyn ska finnas
    await expect(page.getByRole("link", { name: /Ärenden/i }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Kontakter/i }).first()).toBeVisible();
  });

  test("ärendelistan kan navigeras till", async ({ page }) => {
    await page.goto("/matters");
    await expect(page.getByRole("heading", { name: /Ärenden/i }).first()).toBeVisible();
  });

  test("rapportsidan kan öppnas", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: /Rapporter/i }).first()).toBeVisible();
  });
});
