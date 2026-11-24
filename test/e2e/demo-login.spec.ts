/**
 * E2E (demo): en FÄRSK besökare (ingen principal) ska kunna logga in.
 *
 * Regressionsskydd för buggen där hela demon fastnade på "AVA Laddar…":
 * `DemoBootstrap` gate:ade HELA renderingen på `!trpcClient`, men skip-auth-
 * sidorna (/login, /demo) bygger aldrig en trpc-klient (skip-ready-gaten
 * returnerar tidigt). En ny besökare utan `principalId` dirigeras till /login
 * → som aldrig renderade → ingen kunde logga in (#498-regression).
 *
 * Kör mot en lokalt serverad `out/` (default — configen startar servern) eller
 * mot den deployade demon:
 *   bun run e2e:demo
 *   AVA_DEMO_BASE_URL=https://ulrik-s.github.io/ava bun run e2e:demo
 *
 * `test` kommer från `_demo-test` → varje förfrågan utanför testets egen origin
 * blockeras och fäller testet (#932).
 */
import { DEMO_BASE_URL, seedDemoConfig, seedDemoLogin, test, expect } from "./_demo-test";

test("färsk besökare (ingen principal) → /login renderar inloggningen, fastnar inte på 'Laddar…'", async ({ page, context, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");

  // Färsk demo-besökare: tier=demo, INGEN principalId (deterministiskt oavsett
  // build-defaults). Detta är exakt vad en ny besökare på live-demon har.
  await seedDemoConfig(context);

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

// #1864: klienten kör routrarna med den inloggades roll, läst ur hennes rad,
// i stället för ADMIN. En jurist som försöker byta sin egen roll får serverns
// fel redan i webbläsaren.
test("en jurist som försöker byta sin egen roll får felet direkt", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base, "LAWYER");

  const meta = await (await page.request.get(`${base}/.ava/meta.json`)).json() as {
    users: Array<{ id: string; name: string; role: string }>;
  };
  const lawyer = meta.users.find((u) => u.role === "LAWYER");
  if (!lawyer) throw new Error("demon saknar en jurist");
  await page.goto(`${base}/users/`, { waitUntil: "load" });
  await page.getByRole("link", { name: lawyer.name }).click();

  const role = page.getByLabel("Roll");
  await expect(role).toHaveValue("LAWYER", { timeout: 25_000 });
  await role.selectOption("ADMIN");
  await page.getByRole("button", { name: /^Spara$/ }).click();
  await expect(page.getByText("Endast administratörer kan ändra roller.")).toBeVisible({ timeout: 10_000 });
});
