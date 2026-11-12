/**
 * E2E (#1345): en jurist (inte administratör) registrerar tid i ärendet.
 *
 * `timeEntry.create` kräver nu att ärendet och juristen finns i byrån och
 * avvisar setup-fält (annan användare, eget á-pris, fakturakoppling,
 * skapad-datum) för icke-administratörer. UI:t skickar inga sådana fält — det
 * här testet visar att det vanliga flödet fortsätter fungera för en jurist.
 */

import {
  DEMO_BASE_URL, expect, fetchDemoSeed, matterIdWith, seedDemoConfig, seedDemoLogin, showPanel, test, type DemoSeed,
} from "./_demo-test";

test("en jurist registrerar tid i ärendet och posten syns i tidslistan", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  const meta = await (await page.request.get(`${base}/.ava/meta.json`)).json() as {
    organizationId: string;
    users: Array<{ id: string; name: string; role: string }>;
  };
  const lawyer = meta.users.find((u) => u.role === "LAWYER");
  expect(lawyer, "demon har en jurist").toBeDefined();
  await seedDemoConfig(page, { principalId: lawyer?.id ?? "", organizationId: meta.organizationId, authorName: lawyer?.name ?? "" });
  const matterId = matterIdWith(await fetchDemoSeed(page, base), "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  const tid = page.getByRole("region", { name: "Tid" }).last();
  await expect(tid).toBeVisible({ timeout: 25_000 });
  await tid.getByRole("button", { name: /Registrera tid/ }).click();

  const dialog = page.getByRole("dialog", { name: "Registrera tid" });
  const description = "E2E: genomgång av stämningsansökan (#1345)";
  await dialog.getByLabel("Beskrivning *").fill(description);
  await dialog.locator("button[type=submit]").click();

  await expect(dialog).toHaveCount(0);
  await expect(tid.getByText(description)).toBeVisible();
});

/*
 * #1520: rättshjälpens takvarning syns där man arbetar i ärendet — i
 * ärendehuvudet oavsett vilken panel som är öppen, och i tidssektionen. Tid
 * upp till taket registreras i UI:t (demon håller den i minnet), så varningen
 * ska dyka upp direkt utan omladdning.
 */
const WARNING = /Närmar sig taket|Taket passerat/;

/** Första aktiva rättshjälpsärendet (id-sorterat → stabilt) och dess timtak. */
function rattshjalpMatter(seed: DemoSeed): { id: string; capTimmar: number } {
  const matters = seed.matters as Array<DemoSeed["matters"][number] & { rattshjalpMaxTimmar?: number | null }>;
  const hit = matters.filter((m) => m.paymentMethod === "RATTSHJALP" && m.status === "ACTIVE")
    .sort((a, b) => a.id.localeCompare(b.id))[0];
  if (!hit) throw new Error("seeden saknar aktivt rättshjälpsärende");
  return { id: hit.id, capTimmar: hit.rattshjalpMaxTimmar ?? 100 };
}

test("rättshjälp över taket: varningen i huvudet med en annan panel öppen och i tidssektionen", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const matter = rattshjalpMatter(await fetchDemoSeed(page, base));

  await page.goto(`${base}/matters/${matter.id}/`, { waitUntil: "load" });
  const tid = page.getByRole("region", { name: "Tid" }).last();
  await expect(tid).toBeVisible({ timeout: 25_000 });

  // Hela taket i en post → över tröskeln oavsett vad ärendet redan har.
  await tid.getByRole("button", { name: /Registrera tid/ }).click();
  const dialog = page.getByRole("dialog", { name: "Registrera tid" });
  await dialog.getByLabel("Tid (h) *").fill(String(matter.capTimmar));
  await dialog.getByLabel("Beskrivning *").fill("E2E: huvudförhandling (#1520)");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog).toHaveCount(0);

  // Tidsregistreringen blockeras inte — posten finns, och varningen visas.
  await expect(tid.getByText("E2E: huvudförhandling (#1520)")).toBeVisible();
  await expect(tid.getByText(WARNING)).toBeVisible();

  const header = page.getByTestId("matter-header");
  await expect(header.getByText(WARNING)).toBeVisible();

  // En annan panel i samma grupp som Tid → huvudets varning står kvar.
  await showPanel(page, "Utlägg");
  await expect(page.getByRole("region", { name: "Utlägg" }).last()).toBeVisible();
  await expect(header.getByText(WARNING)).toBeVisible();
});

/*
 * #1529: milersättning som utlägg. Juristen anger resan i ärendets Utlägg-sektion
 * och raden syns i listan med mil × kr/mil exkl. moms och 25 % pålagd moms.
 */
test("en milersättning läggs in i ärendet och syns i utläggslistan med moms", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const matterId = matterIdWith(await fetchDemoSeed(page, base), "expenses");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  await showPanel(page, "Utlägg");
  const utlagg = page.getByRole("region", { name: "Utlägg" }).last();
  await expect(utlagg).toBeVisible({ timeout: 25_000 });
  await utlagg.getByRole("button", { name: "+ Milersättning" }).click();

  const dialog = page.getByRole("dialog", { name: "Milersättning" });
  await dialog.getByLabel("Från *").fill("E2E-start");
  await dialog.getByLabel("Till *").fill("E2E-mål");
  await dialog.getByLabel("Antal mil *").fill("3,5");
  await dialog.getByLabel("Kr/mil *").fill("25");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog).toHaveCount(0);

  const row = utlagg.getByRole("row").filter({ hasText: "Milersättning E2E-start – E2E-mål, 3,5 mil à 25 kr" });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/87,50/);
  await expect(row).toContainText(/21,88/);
  await expect(row).toContainText(/109,38/);
});

/*
 * #1545: tid matas in i timmar med decimal. "1,33" är inte ett tillåtet värde
 * (6-minutersintervall och kvartar) och ger ett fel i stället för att avrundas;
 * "1,5" sparas och raden visar "1,5".
 */
test("tidssidan: tid i timmar — 1,33 ger fel, 1,5 sparas och visas som 1,5", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matter = seed.matters.find((m) => m.status === "ACTIVE" && m.matterNumber);
  expect(matter, "demon har ett aktivt ärende").toBeDefined();

  await page.goto(`${base}/time/`, { waitUntil: "load" });
  await page.getByRole("button", { name: /\+ Registrera tid/ }).click();
  await page.getByLabel("Ärende *").fill(`${matter?.matterNumber ?? ""} — ${matter?.title ?? ""}`);
  const description = "E2E: tid i timmar (#1545)";
  await page.getByLabel("Beskrivning *").fill(description);

  const hours = page.getByLabel("Tid (h) *");
  await hours.fill("1,33");
  await expect(page.getByRole("alert").filter({ hasText: "Ändra värdet" })).toBeVisible();
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(page.getByText(description)).toHaveCount(0);

  await hours.fill("1,5");
  await expect(page.getByRole("alert").filter({ hasText: "Ändra värdet" })).toHaveCount(0);
  await page.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(page.getByRole("row", { name: new RegExp(description.replace(/[()]/g, "\\$&")) })).toContainText("1,5");
});
