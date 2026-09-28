/**
 * E2E (demo): AVA ber om beständig lagring och säger ärligt vad den fick (#1241).
 *
 * Utan `navigator.storage.persist()` får webbläsaren tömma IndexedDB — där
 * ligger osynkade ändringar och ärenden för offline-arbete. /settings visar nu
 * svaret. Webbläsarens beslut styrs av heuristik (engagemang, installerad app),
 * så två av testerna låser svaret med ett init-skript; det tredje kör mot
 * Chromiums riktiga API och kräver bara att frågan faktiskt ställdes.
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

/** Lås webbläsarens svar på persist() och räkna anropen. */
async function stubPersist(page: Page, granted: boolean): Promise<void> {
  await page.addInitScript((grant) => {
    window.__persistCalls = 0;
    let persisted = false;
    Object.defineProperty(StorageManager.prototype, "persisted", { configurable: true, value: async () => persisted });
    Object.defineProperty(StorageManager.prototype, "persist", {
      configurable: true,
      value: async () => { window.__persistCalls = (window.__persistCalls ?? 0) + 1; persisted = grant; return grant; },
    });
  }, granted);
}

declare global {
  interface Window { __persistCalls?: number }
}

const status = (page: Page) => page.getByTestId("storage-status");

/** /settings är dockade paneler; lagringsstatusen ligger under "Datakälla". */
async function openStorageStatus(page: Page): Promise<void> {
  await page.goto(`${BASE}/settings/`);
  await showPanel(page, "Datakälla");
}

test("webbläsaren beviljar → Inställningar visar 'Beständig'", async ({ page }) => {
  await stubPersist(page, true);
  await seedDemoLogin(page, BASE);
  await openStorageStatus(page);
  await expect(status(page)).toHaveAttribute("data-persistence", "persisted", { timeout: 30_000 });
  await expect(status(page)).toContainText("Beständig");
  expect(await page.evaluate(() => window.__persistCalls ?? 0)).toBeGreaterThan(0);
});

test("webbläsaren nekar → varning om att datan kan rensas", async ({ page }) => {
  await stubPersist(page, false);
  await seedDemoLogin(page, BASE);
  await openStorageStatus(page);
  await expect(status(page)).toHaveAttribute("data-persistence", "not-persisted", { timeout: 30_000 });
  await expect(status(page)).toContainText("Kan rensas av webbläsaren");
});

test("riktiga API:t: frågan ställs och svaret visas (aldrig 'stöds inte' i en säker kontext)", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await openStorageStatus(page);
  await expect(status(page)).toHaveAttribute("data-persistence", /^(persisted|not-persisted)$/, { timeout: 30_000 });
});
