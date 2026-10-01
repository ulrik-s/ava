/**
 * E2E (demo, #1391): ett fel innan appen har sin tRPC-klient visas — appen
 * hänger inte på "Laddar…".
 *
 * Felskärmen låg i appträdet, som kräver klienten, så ett fel under uppstarten
 * (self-hosted: inloggad men saknas i byrån; demo: seeden går inte att hämta)
 * syntes aldrig. Demon har ingen server, så felet framkallas här med en seed
 * som inte går att hämta. Samma skärm visar self-hosted-felet (enhetstestat).
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, test, expect } from "./_demo-test";

test("seeden går inte att hämta → felet och 'Försök igen' visas, inte 'Laddar…'", async ({ page }) => {
  await seedDemoLogin(page, BASE);
  await page.route("**/demo-seed.json", (route) => route.fulfill({ status: 503, body: "nere" }));
  await page.goto(`${BASE}/matters/`);

  const alert = page.getByRole("alert").filter({ hasText: "AVA kunde inte starta" });
  await expect(alert).toBeVisible({ timeout: 25_000 });
  await expect(alert).toContainText("HTTP 503");
  await expect(page.getByText("Laddar…")).toHaveCount(0);

  // Servern är tillbaka → "Försök igen" startar om och appen kommer upp.
  await page.unroute("**/demo-seed.json");
  await alert.getByRole("button", { name: "Försök igen" }).click();
  await expect(page.getByRole("heading", { name: "Ärenden" })).toBeVisible({ timeout: 25_000 });
});
