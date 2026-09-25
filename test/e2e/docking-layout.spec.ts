/**
 * Dockbar ärendesida (#1185): ingen sidscroll på 13"-laptop, stor skärm och
 * telefon; flikar går att dra till en annan grupp; "Återställ layout" ger
 * standarden tillbaka.
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL, fetchDemoSeed, matterIdWith, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

async function openMatter(page: Page, base: string): Promise<void> {
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  await page.goto(`${base}/matters/${matterIdWith(seed, "timeEntries")}/`, { waitUntil: "load" });
  await expect(page.getByRole("tab", { name: /^Tid/ }).first()).toBeVisible({ timeout: 30_000 });
}

const pageScroll = (page: Page) => page.evaluate(() => {
  const main = document.querySelector("main");
  return {
    doc: document.documentElement.scrollHeight - document.documentElement.clientHeight,
    main: main ? main.scrollHeight - main.clientHeight : 0,
  };
});

for (const [name, width, height] of [["13\" laptop", 1470, 956], ["stor skärm", 2560, 1440], ["telefon", 390, 844]] as const) {
  test(`ingen sidscroll på ${name}`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width, height });
    await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
    await showPanel(page, "Dokument");
    expect(await pageScroll(page)).toEqual({ doc: 0, main: 0 });
  });
}

/** Gruppen (dockviews flikrad) en flik ligger i. */
const groupOf = (page: Page, title: string) =>
  page.locator(".dv-groupview").filter({ has: page.getByRole("tab", { name: new RegExp(`^${title}`) }) });

test("dra en flik till en annan grupp och återställ", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await openMatter(page, (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, ""));
  const kontakter = page.getByRole("tab", { name: /^Kontakter/ });
  await expect(groupOf(page, "Tid").getByRole("tab", { name: /^Kontakter/ })).toHaveCount(0);

  await kontakter.dragTo(page.getByRole("tab", { name: /^Utlägg/ }));
  await expect(groupOf(page, "Tid").getByRole("tab", { name: /^Kontakter/ })).toHaveCount(1);

  await page.getByRole("button", { name: "Återställ layout" }).click();
  await expect(groupOf(page, "Att bevaka").getByRole("tab", { name: /^Kontakter/ })).toHaveCount(1, { timeout: 15_000 });
});
