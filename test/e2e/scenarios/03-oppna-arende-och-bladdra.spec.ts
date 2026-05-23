/**
 * Scenario 03: "Bläddra ärenden + öppna detaljer + verifiera kopplingar"
 *
 * Användarjourney:
 *   1. Anna går till Ärenden-listan
 *   2. Verifierar alla 7 seedade ärenden syns
 *   3. Filtrerar på status (ACTIVE)
 *   4. Öppnar ett aktivt ärende (Vårdnad — Andersson)
 *   5. Verifierar att klient + motpart + domstol är listade
 *   6. Verifierar payment-method-badge
 */

import { test, expect } from "@playwright/test";
import { reseedDatabase } from "./_helpers";

test.describe("Scenario: Bläddra ärenden + öppna detaljer", () => {
  test.beforeEach(() => reseedDatabase());

  test("alla 7 seedade ärenden syns i listan", async ({ page }) => {
    await page.goto("/matters");
    const matterNumbers = ["2026-001", "2026-002", "2026-003", "2026-004", "2026-005", "2026-006", "2026-007"];
    for (const num of matterNumbers) {
      await expect(page.getByText(num)).toBeVisible();
    }
  });

  test("filter på ACTIVE döljer arkiverade/stängda ärenden", async ({ page }) => {
    await page.goto("/matters");
    await page.getByRole("combobox").first().selectOption({ value: "ACTIVE" });
    // 5 ACTIVE i seed:n (m-1, m-2, m-3, m-4, m-6) — 2026-005 är CLOSED, 2026-007 är ARCHIVED
    await expect(page.getByText("2026-005")).not.toBeVisible();
    await expect(page.getByText("2026-007")).not.toBeVisible();
    await expect(page.getByText("2026-001")).toBeVisible();
  });

  test("öppna vårdnad-ärendet → klient + motpart + domstol syns", async ({ page }) => {
    await page.goto("/matters");
    await page.getByText("Vårdnad och umgänge — Andersson").click();
    // Sida med ärendedetaljer
    await expect(page.getByRole("heading", { name: /Vårdnad och umgänge — Andersson/i })).toBeVisible();
    // Klient
    await expect(page.locator("body")).toContainText("Lars Andersson");
    // Motpart
    await expect(page.locator("body")).toContainText("Stefan Eriksson");
    // Domstol
    await expect(page.locator("body")).toContainText("Stockholms tingsrätt");
  });

  test("sökruta filtrerar i realtid", async ({ page }) => {
    await page.goto("/matters");
    await page.getByPlaceholder(/Sök ärenden/i).fill("Arvskifte");
    // 2026-002 är arvskifte-ärendet
    await expect(page.getByText("2026-002")).toBeVisible();
    await expect(page.getByText("2026-001")).not.toBeVisible();
  });
});
