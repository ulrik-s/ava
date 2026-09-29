/**
 * E2E (demo): sidorna scrollar aldrig — panelerna och listorna scrollar själva (#1306).
 *
 * - Menyn var ~922 px hög utan egen scroll. I ett lägre fönster sträckte den ut
 *   raden, och hela dokumentet gick att scrolla en bit.
 * - `sr-only`-etiketter (position: absolute) i en panel räknades mot dockviews
 *   `.dv-view`, som då fick en egen scrollbar ovanpå panelens: två scrollbarer
 *   i t.ex. ärendets "Att bevaka".
 */
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, fetchDemoSeed, matterIdWith, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

/** Hur mycket dokumentet och `main` kan scrollas (0 = inte alls). */
async function pageOverflow(page: Page): Promise<{ doc: number; main: number }> {
  return page.evaluate(() => {
    const main = document.querySelector("main");
    return {
      doc: document.documentElement.scrollHeight - window.innerHeight,
      main: main ? main.scrollHeight - main.clientHeight : 0,
    };
  });
}

/** Antal dockview-vyer som går att scrolla (panelkroppen ska vara den enda som scrollar). */
async function scrollingDockViews(page: Page): Promise<number> {
  return page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".dv-view")]
    .filter((v) => v.scrollHeight > v.clientHeight + 1).length);
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE}${path}`);
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);
}

for (const [label, width, height] of [["hela menyn", 1470, 700], ["ikonmenyn", 900, 560]] as const) {
  test(`lågt fönster (${label}, ${width}×${height}): ingen sida scrollar, menyns sista val nås`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await seedDemoLogin(page, BASE);
    const seed = await fetchDemoSeed(page, BASE);
    for (const path of ["/", "/matters/", `/matters/${matterIdWith(seed, "timeEntries")}/`, "/time/", "/reports/"]) {
      await open(page, path);
      expect(await pageOverflow(page), path).toEqual({ doc: 0, main: 0 });
    }
    // Menyn scrollar själv: det sista valet går att nå och klicka.
    const settings = page.getByRole("link", { name: /Inställningar$/ }).first();
    await settings.scrollIntoViewIfNeeded();
    await settings.click();
    await expect(page).toHaveURL(/\/settings\/?$/);
    expect(await pageOverflow(page)).toEqual({ doc: 0, main: 0 });
  });
}

test("ärendets Att bevaka och startsidan: bara panelkroppen scrollar, inte dockview-vyn", async ({ page }) => {
  await page.setViewportSize({ width: 1470, height: 956 });
  await seedDemoLogin(page, BASE);
  const seed = await fetchDemoSeed(page, BASE);
  await open(page, `/matters/${matterIdWith(seed, "timeEntries")}/`);
  await showPanel(page, "Att bevaka");
  await expect(page.locator("section[aria-label='Att bevaka']").first()).toBeVisible();
  expect(await scrollingDockViews(page)).toBe(0);

  await open(page, "/");
  expect(await scrollingDockViews(page)).toBe(0);
});
