/**
 * E2E (demo): en FÄRSK besökare (ingen principal) ska kunna logga in.
 *
 * Regressionsskydd för buggen där hela demon fastnade på "AVA Laddar…":
 * `DemoBootstrap` gate:ade HELA renderingen på `!trpcClient`, men skip-auth-
 * sidorna (/login, /demo) bygger aldrig en trpc-klient (skip-ready-gaten
 * returnerar tidigt). En ny besökare utan `principalId` dirigeras till /login
 * → som aldrig renderade → ingen kunde logga in (#498-regression).
 *
 * Testet kör mot den deployade demon (default) eller en lokalt serverad out/:
 *   AVA_DEMO_BASE_URL=http://localhost:8080/ava bun run e2e:demo
 */
import { test, expect } from "@playwright/test";

test("färsk besökare (ingen principal) → /login renderar inloggningen, fastnar inte på 'Laddar…'", async ({ page, context, baseURL }) => {
  const base = baseURL ?? "https://ulrik-s.github.io/ava";

  // Färsk demo-besökare: tier=demo, INGEN principalId (deterministiskt oavsett
  // build-defaults). Detta är exakt vad en ny besökare på live-demon har.
  await context.addInitScript(() => {
    try {
      localStorage.setItem("ava.firma", JSON.stringify({
        tier: "demo", repo: "ulrik-s/ava", token: "",
        principalId: "", organizationId: "", authorName: "", authorEmail: "",
      }));
    } catch { /* ignore */ }
  });

  await page.goto(`${base}/`, { waitUntil: "domcontentloaded" });

  // Utan principal → bootstrap dirigerar till /login.
  await expect(page).toHaveURL(/\/login\/?$/, { timeout: 20_000 });

  // /login renderar sitt eget innehåll (rubrik + Logga in-knapp) — INTE bara
  // DemoBootstrap-platshållaren. (Rubriken renderas oberoende av meta-laddning.)
  await expect(page.getByRole("heading", { name: /Logga in/i })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Logga in$/ })).toBeVisible({ timeout: 20_000 });

  // Explicit regressionsvakt: vi får INTE ha fastnat på "AVA Laddar…"-skärmen.
  const body = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  expect(body, "demon fastnade på bootstrap-platshållaren").not.toBe("AVA Laddar…");
});
