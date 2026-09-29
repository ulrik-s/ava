/**
 * E2E (demo): ett Graph-anrop som hänger får inte blockera jobbkön (#1286).
 *
 * Buggen: jobbkön kör ett jobb per kind. "Avbryt" skickade bara en signal
 * till workern och väntade sedan på att den returnerade. Outlook-speglingens
 * Graph-anrop tog ingen signal, så ett anrop som hängde gjorde att jobbet stod
 * kvar som "Körs", och alla följande speglingar blev kvar som "Köad" tills
 * fliken laddades om.
 *
 * Flödet i UI:t: Outlook "anslutet" (token i localStorage), Graph svarar
 * aldrig. Två kalenderhändelser speglas → den första hänger, den andra köas.
 * På /jobs klickar användaren "Avbryt" på den som hänger. Den ska bli
 * "Avbruten" direkt, och den andra speglingen ska starta (ett nytt
 * Graph-anrop).
 */
import { DEMO_BASE_URL as BASE, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

test("Graph hänger → Avbryt på /jobs släpper kön, och nästa spegling startar", async ({ page }) => {
  const graphCalls: string[] = [];
  // Registreras efter hermetik-vakten och vinner därför för Graph-origin.
  // Ingen fulfill/abort: anropet hänger, som ett Graph som inte svarar.
  await page.route("https://graph.microsoft.com/**", (route) => { graphCalls.push(route.request().url()); });
  await page.addInitScript(() => {
    try { localStorage.setItem("ava.outlookToken", "e2e-outlook-token"); } catch { /* privat läge */ }
  });
  await seedDemoLogin(page, BASE);
  await page.goto(`${BASE}/calendar/`);
  await showPanel(page, "Kalender");

  for (const [title, start] of [["Hänger i Graph", "2026-10-05T09:00"], ["Nästa spegling", "2026-10-06T09:00"]] as const) {
    await page.getByRole("button", { name: /Nytt event/ }).click();
    const form = page.locator("form").filter({ hasText: "Spegla till Outlook" });
    await form.getByLabel("Titel *").fill(title);
    await form.getByLabel("Start *").fill(start);
    await form.getByLabel(/Spegla till Outlook/).check();
    await form.getByRole("button", { name: "Skapa" }).click();
    await expect(form).toBeHidden({ timeout: 15_000 });
  }
  await expect.poll(() => graphCalls.length, { timeout: 15_000 }).toBe(1);

  // Klientnavigering via jobb-badgen: kön lever i fliken och får inte laddas om.
  await page.getByRole("link", { name: /jobb körs/ }).click();
  await expect(page.getByRole("heading", { name: "Jobbkö" })).toBeVisible();
  const hung = page.getByRole("row", { name: /Hänger i Graph/ });
  const next = page.getByRole("row", { name: /Nästa spegling/ });
  await expect(hung).toContainText("↻"); // kör (visar förlopp, t.ex. "↻ 40%")
  await expect(next).toContainText("Köad");

  await hung.getByRole("button", { name: /Avbryt/ }).click();

  // Nästa spegling startar direkt: ett nytt Graph-anrop, och raden kör.
  await expect.poll(() => graphCalls.length, { timeout: 10_000, message: "nästa spegling ska starta när den som hänger avbryts" }).toBe(2);
  await expect(next).toContainText("↻");
  await showPanel(page, "Historik");
  await expect(page.getByRole("row", { name: /Hänger i Graph/ })).toContainText("Avbruten");
});
