/**
 * Skyddstest (#1368): ett e2e-test kan inte nå AVA Helper på standardporten.
 *
 * Utan isolering hittade e2e:t den RIKTIGA helpern på utvecklarens dator, och
 * "Generera + öppna mail" startade Mail.app om och om igen. Testet bevisar båda
 * lagren i `_helper-isolation`:
 *   1. appen får den döda helper-basen innan dess kod kör, och dess probe går
 *      dit — inte till standardporten;
 *   2. en förfrågan som ändå går till standardporten avbryts och noteras (och
 *      skulle fälla testet).
 */
import { DEMO_BASE_URL, expect, seedDemoLogin, showPanel, test } from "./_demo-test";
import { DEAD_HELPER_BASE, DEFAULT_HELPER_ORIGINS, HELPER_BASE_OVERRIDE_KEY } from "./_helper-isolation";

test("appens helper-probe går till den döda basen, aldrig standardporten", async ({ page, defaultHelperHits }) => {
  await seedDemoLogin(page);
  const probe = page.waitForEvent("requestfailed", (r) => r.url().startsWith(`${DEAD_HELPER_BASE}/`));

  await page.goto(`${DEMO_BASE_URL}/settings/`);
  await showPanel(page, "Extern editering"); // HelperSection probar helpern
  await expect(page.getByRole("heading", { name: "AVA Helper" })).toBeVisible();

  expect(await page.evaluate((key) => localStorage.getItem(key), HELPER_BASE_OVERRIDE_KEY)).toBe(DEAD_HELPER_BASE);
  expect((await probe).url()).toBe(`${DEAD_HELPER_BASE}/ping`);
  expect(defaultHelperHits).toEqual([]);
});

test("en förfrågan till standardporten avbryts och noteras", async ({ page, defaultHelperHits }) => {
  await seedDemoLogin(page);
  await page.goto(`${DEMO_BASE_URL}/login/`);

  for (const origin of DEFAULT_HELPER_ORIGINS) {
    const reached = await page.evaluate(
      (url) => fetch(url).then(() => true, () => false),
      `${origin}/compose-mail`,
    );
    expect(reached, `${origin} ska vara spärrad`).toBe(false);
  }

  expect(defaultHelperHits).toEqual(DEFAULT_HELPER_ORIGINS.map((o) => `${o}/compose-mail`));
  defaultHelperHits.length = 0; // avsiktliga träffar — annars fäller vakten testet
});
