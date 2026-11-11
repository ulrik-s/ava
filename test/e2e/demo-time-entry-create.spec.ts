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
  await dialog.getByLabel("Tid (minuter) *").fill(String(matter.capTimmar * 60));
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
