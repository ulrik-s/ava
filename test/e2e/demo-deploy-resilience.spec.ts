/**
 * E2E (demo, #1355): flikar som lever över en deploy.
 *
 *   1. Två flikar, en ny version: "Ladda om" i den ena låter den nya versionen
 *      ta över ALLA flikar. Förut fick bara den klickande fliken veta det; den
 *      andra körde vidare på det gamla skalet (och kraschade när dess chunks
 *      försvann). Nu får den frågan, och "Ladda om" laddar om den.
 *   2. Ett chunk som inte längre finns på servern (prod raderar förra releasen
 *      vid nästa deploy): fliken laddas om en gång. Kommer felet igen direkt
 *      blir det ett besked i stället för en omladdningsloop.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
}

test.describe("med service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("två flikar: 'Ladda om' i den ena → den andra får veta att AVA uppdaterats", async ({ page, context }) => {
    test.skip(Boolean(process.env.AVA_DEMO_BASE_URL), "kräver att specen kan skriva om den lokalt serverade out/sw.js");
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/`);
    await waitForServiceWorker(page);
    const other = await context.newPage();
    await other.goto(`${BASE}/matters/`);
    await waitForServiceWorker(other);

    const swPath = join(process.cwd(), "out", "sw.js");
    const original = await readFile(swPath, "utf8");
    try {
      await writeFile(swPath, `${original}\n// e2e-deploy ${Date.now()}\n`);
      await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; await reg.update(); });
      await expect(page.getByText(/En ny version av AVA finns/)).toBeVisible({ timeout: 30_000 });

      await Promise.all([
        page.waitForEvent("load", { timeout: 30_000 }),
        page.getByRole("button", { name: /Ladda om/ }).click(),
      ]);
      await expect(other.getByText(/AVA har uppdaterats i en annan flik/)).toBeVisible({ timeout: 30_000 });
      await Promise.all([
        other.waitForEvent("load", { timeout: 30_000 }),
        other.getByRole("button", { name: /Ladda om/ }).click(),
      ]);
      await expect(other.getByText(/AVA har uppdaterats/)).toHaveCount(0);
    } finally {
      await writeFile(swPath, original);
    }
  });
});

test("ett chunk som inte längre finns → en omladdning; igen direkt → besked, ingen loop", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/matters/`);
  await expect(page.getByRole("heading", { name: "Ärenden" })).toBeVisible({ timeout: 30_000 });

  const missingChunk = `${new URL(BASE).pathname}/_next/static/chunks/borttaget-av-deployen.js`;
  const loadMissing = (url: string) => { setTimeout(() => { void import(/* webpackIgnore: true */ url); }, 0); };

  await Promise.all([page.waitForEvent("load", { timeout: 30_000 }), page.evaluate(loadMissing, missingChunk)]);
  await expect(page.getByRole("heading", { name: "Ärenden" })).toBeVisible({ timeout: 30_000 });

  await page.evaluate(loadMissing, missingChunk);
  await expect(page.getByText(/Delar av AVA kunde inte laddas/)).toBeVisible({ timeout: 15_000 });
});
