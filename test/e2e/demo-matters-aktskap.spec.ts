/**
 * E2E (demo, #1968): ärendelistans flikar Mitt aktskåp och Alla ärenden på byrån.
 *
 * Ärenden i sidomenyn öppnar alltid Mitt aktskåp: aktiva ärenden där den
 * inloggade är ansvarig, där något senast hänt överst. Alla ärenden på byrån
 * är dagens lista med valrutorna, och fliken står i adressen (`?flik=alla`).
 * Ordningen prövas som beteende (demons poster har byggtiden som `updatedAt`),
 * inte som en fast ordning.
 */

import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, fetchDemoSeed, seedDemoLogin, test, expect } from "./_demo-test";

/** Klicka på Ärenden i sidomenyn och vänta in listan. */
async function openMattersFromMenu(page: Page): Promise<void> {
  await page.getByRole("link", { name: /Ärenden/ }).first().click();
  await expect(page.getByRole("tab", { name: "Mitt aktskåp" })).toHaveAttribute("aria-selected", "true");
  await page.locator("table tbody tr").first().waitFor({ timeout: 25_000 });
}

/** Titlarna i listan, uppifrån och ned. */
async function rowTitles(page: Page): Promise<string[]> {
  return page.locator("table tbody tr").allTextContents();
}

test.beforeEach(async ({ page }) => {
  await seedDemoLogin(page, BASE);
});

test("sidomenyn ger Mitt aktskåp: bara aktiva ärenden och inga valrutor", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  const closed = seed.matters.filter((m) => m.status === "CLOSED").map((m) => m.title);
  expect(closed.length, "demon har stängda ärenden").toBeGreaterThan(0);

  await page.goto(`${BASE}/`);
  await openMattersFromMenu(page);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByPlaceholder("Sök ärenden...")).toBeVisible();
  const panel = page.getByRole("tabpanel", { name: "Mitt aktskåp" });
  for (const title of closed) await expect(panel.getByText(title, { exact: true })).toHaveCount(0);
});

test("ett ärende där man registrerat tid står överst i Mitt aktskåp", async ({ page }) => {
  await page.goto(`${BASE}/`);
  await openMattersFromMenu(page);
  const rows = page.locator("table tbody tr");
  expect(await rows.count(), "fliken har flera ärenden").toBeGreaterThan(1);
  const last = rows.last().getByRole("link").first();
  const title = (await last.textContent())?.trim() ?? "";
  expect(title).not.toBe("");
  await last.click();

  const tid = page.getByRole("region", { name: "Tid" }).last();
  await expect(tid).toBeVisible({ timeout: 25_000 });
  await tid.getByRole("button", { name: /Registrera tid/ }).click();
  const dialog = page.getByRole("dialog", { name: "Registrera tid" });
  await dialog.getByLabel("Beskrivning *").fill("E2E: Mitt aktskåp (#1968)");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog).toHaveCount(0);

  await openMattersFromMenu(page);
  await expect.poll(async () => (await rowTitles(page))[0] ?? "").toContain(title);
});

test("Alla ärenden på byrån visar stängda ärenden och valrutorna; sidomenyn ger Mitt aktskåp igen", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  const closed = seed.matters.find((m) => m.status === "CLOSED");
  expect(closed, "demon har ett stängt ärende").toBeDefined();

  await page.goto(`${BASE}/`);
  await openMattersFromMenu(page);
  await page.getByRole("tab", { name: "Alla ärenden på byrån" }).click();
  await expect(page).toHaveURL(/[?&]flik=alla/);
  await expect(page.getByRole("tab", { name: "Alla ärenden på byrån" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("combobox")).toHaveCount(2);
  await expect(page.getByRole("tabpanel", { name: "Alla ärenden på byrån" }).getByText(closed?.title ?? "", { exact: true })).toBeVisible();

  await openMattersFromMenu(page);
  await expect(page).not.toHaveURL(/flik=alla/);
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
