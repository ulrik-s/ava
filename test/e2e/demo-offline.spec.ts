/**
 * E2E (demo): appen går att ÖPPNA offline (#1240).
 *
 * Buggen: `public/sw.js` var en avstängningsbrytare som rensade alla cacher och
 * avregistrerade sig, och `PwaRegister` avregistrerade dessutom varje service
 * worker i alla statiska byggen. En omladdning eller en ny flik under ett
 * avbrott gav därför ingen app alls — bara en redan öppen flik fungerade.
 *
 * Specen kör hela vägen i en riktig Chromium mot den byggda `out/`:
 *   1. ett besök online installerar service workern och förcachar skalet,
 *   2. nätet stängs av,
 *   3. omladdning, ny flik, ett ärende och ett okänt id öppnas ändå — datan
 *      kommer ur IndexedDB, skalet ur service workerns cache.
 *
 * Kontrolltestet (utan service worker) visar att samma omladdning offline
 * annars misslyckas, så att grönt här faktiskt betyder något.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { DEMO_BASE_URL as BASE, fetchDemoSeed, seedDemoLogin, test, expect, type DemoSeed } from "./_demo-test";

/** Nyaste ärendet — sida 1 i listan (sorterad createdAt DESC), stabilt mellan byggen. */
function newestMatter(seed: DemoSeed): { id: string; title: string } {
  const sorted = [...seed.matters].sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  const m = sorted[0];
  if (!m) throw new Error("seeden saknar ärenden");
  return m;
}

/** Vänta tills service workern är aktiv OCH styr sidan (då är skalet förcachat). */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 });
}

test.describe("med service worker", () => {
  test.use({ serviceWorkers: "allow" });

  test("efter ett besök öppnas appen offline: omladdning, ny flik, ärende och okänt id", async ({ page, context }) => {
    const seed = await fetchDemoSeed(page, BASE);
    const matter = newestMatter(seed);
    await seedDemoLogin(page, BASE);

    await page.goto(`${BASE}/matters/`);
    await expect(page.getByText(matter.title).first()).toBeVisible({ timeout: 30_000 });
    await waitForServiceWorker(page);

    await context.setOffline(true);

    // 1. Omladdning av listan.
    await page.reload();
    await expect(page.getByText(matter.title).first()).toBeVisible({ timeout: 30_000 });

    // 2. En NY flik (ingen sida i minnet) — det var det som aldrig fungerade.
    //    Inloggningen ligger redan i kontextens localStorage (första sidan).
    const tab = await context.newPage();
    await tab.goto(`${BASE}/`);
    await expect(tab.locator("body")).toContainText(/Startsida|AVA/i, { timeout: 30_000 });

    // 3. Ett ärende vars sida aldrig besökts → __shell__-skalet ur cachen,
    //    ärendet ur IndexedDB.
    await tab.goto(`${BASE}/matters/${matter.id}/`);
    await expect(tab.getByText(matter.title).first()).toBeVisible({ timeout: 30_000 });

    // 4. Ett id som inte finns → APPEN svarar (inte browserns offline-sida):
    //    skalet renderar och säger att ärendet saknas.
    await tab.goto(`${BASE}/matters/0190a1b2-0000-7000-8000-00000000dead/`);
    await expect(tab.getByText(/Ärendet finns inte/)).toBeVisible({ timeout: 30_000 });

    await context.setOffline(false);
  });

  test("data cachas aldrig: offline når inte demo-seed.json eller .ava/, men RSC-payloaden svarar", async ({ page, context }) => {
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/`);
    await waitForServiceWorker(page);
    await context.setOffline(true);

    const results = await page.evaluate(async (base) => {
      const tryFetch = async (url: string): Promise<string> => {
        try { const r = await fetch(url); return `ok:${r.status}`; } catch { return "nätfel"; }
      };
      return {
        seed: await tryFetch(`${base}/demo-seed.json`),
        meta: await tryFetch(`${base}/.ava/meta.json`),
        rsc: await tryFetch(`${base}/matters/index.txt`),
        page: await tryFetch(`${base}/matters/`),
      };
    }, new URL(BASE).pathname.replace(/\/+$/, ""));

    expect(results.seed).toBe("nätfel");
    expect(results.meta).toBe("nätfel");
    // RSC-payloaden (klientnavigering) är skal → svarar ur cachen.
    expect(results.rsc).toBe("ok:200");
    // En vanlig fetch av en sida är INTE en navigering → ingen skal-fallback.
    expect(results.page).toBe("nätfel");
    await context.setOffline(false);
  });

  test("ny version → användaren tillfrågas; 'Ladda om' byter till den", async ({ page }) => {
    test.skip(Boolean(process.env.AVA_DEMO_BASE_URL), "kräver att specen kan skriva om den lokalt serverade out/sw.js");
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/`);
    await waitForServiceWorker(page);
    await expect(page.getByRole("button", { name: /Ladda om/ })).toHaveCount(0);

    const swPath = join(process.cwd(), "out", "sw.js");
    const original = await readFile(swPath, "utf8");
    try {
      // En byte-annorlunda sw.js är vad en ny deploy ser ut som för browsern.
      await writeFile(swPath, `${original}\n// e2e-ny-version ${Date.now()}\n`);
      await page.evaluate(async () => { const reg = await navigator.serviceWorker.ready; await reg.update(); });

      await expect(page.getByText(/En ny version av AVA finns/)).toBeVisible({ timeout: 30_000 });
      const oldController = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
      await Promise.all([
        page.waitForEvent("load", { timeout: 30_000 }),
        page.getByRole("button", { name: /Ladda om/ }).click(),
      ]);
      await expect(page.getByText(/En ny version av AVA finns/)).toHaveCount(0);
      const newController = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
      expect(newController).toBe(oldController); // samma URL …
      const waiting = await page.evaluate(async () => (await navigator.serviceWorker.ready).waiting);
      expect(waiting, "… men ingen version väntar längre").toBeNull();
    } finally {
      await writeFile(swPath, original);
    }
  });
});

test.describe("kontroll: utan service worker", () => {
  test.use({ serviceWorkers: "block" });

  test("samma omladdning offline misslyckas — det är service workern som bär skalet", async ({ page, context }) => {
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/matters/`);
    await context.setOffline(true);
    await expect(page.reload()).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
    await context.setOffline(false);
  });
});

test.describe("ändringar offline (#1241)", () => {
  test("en ny kontakt sparas offline i en öppen flik — hänger inte på 'Sparar…'", async ({ page, context }) => {
    await seedDemoLogin(page, BASE);
    await page.goto(`${BASE}/contacts/`);
    await expect(page.getByRole("button", { name: "+ Ny kontakt" })).toBeVisible({ timeout: 30_000 });

    // `offline`-händelsen är det som fick TanStack Query att pausa mutationen.
    await context.setOffline(true);
    const name = `Offline-kontakt ${Date.now()}`;
    await page.getByRole("button", { name: "+ Ny kontakt" }).click();
    await page.getByLabel("Namn *").fill(name);
    await page.getByRole("button", { name: "Spara kontakt" }).click();

    await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Sparar..." })).toHaveCount(0);
    await context.setOffline(false);
  });
});
