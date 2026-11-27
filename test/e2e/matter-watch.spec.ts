/**
 * E2E (#1162/#1167/#1735): en frist med dagens datum i ärendets "Frister"
 * lyser rött där OCH i "Frister" på startsidan — EN lista. Demon håller
 * ändringar i minnet, så vi går till startsidan via menyn (klient-navigering).
 */

import type { Page } from "@playwright/test";
import { DEMO_BASE_URL, type DemoSeed, fetchDemoSeed, matterIdWith, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

/** Ärendets första KLIENT-part ur seeden (#1965), i kopplingarnas ordning. */
function klientOf(seed: DemoSeed, matterId: string): string {
  const name = seed.matterContacts
    .filter((l) => l.matterId === matterId && l.role === "KLIENT")
    .sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))[0]?.contact?.name;
  if (!name) throw new Error(`seedens ärende ${matterId} saknar klient`);
  return name;
}

test("frist idag: röd i ärendet och i Frister på startsidan", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matterId = matterIdWith(seed, "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  // Innersta: dockview märker även panelens yta med titeln (#1185).
  const section = page.getByRole("region", { name: "Frister" }).last();
  await expect(section).toBeVisible({ timeout: 25_000 });

  // "Idag" i byråns tid — samma dag som appen räknar med (stockholmDay), inte
  // testmaskinens UTC-datum (som är gårdagen mellan 22 och 24 UTC).
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm" }).format(new Date());
  await section.getByLabel("Frist", { exact: true }).fill("E2E-frist: överklagandefrist");
  await section.getByLabel("Datum", { exact: true }).fill(today);
  await section.getByRole("button", { name: "Lägg till" }).click();

  const row = section.locator("li", { hasText: "E2E-frist: överklagandefrist" });
  await expect(row.getByRole("alert")).toHaveText("FRIST IDAG");
  // Ärendets egen flik visar inte klienten (#1965).
  const klient = klientOf(seed, matterId);
  await expect(row).not.toContainText(klient);

  await page.getByRole("link", { name: /Startsida/ }).first().click();
  const watchRow = page.locator("li", { hasText: "E2E-frist: överklagandefrist" });
  await expect(watchRow).toBeVisible({ timeout: 15_000 });
  await expect(watchRow.getByRole("alert")).toHaveText("FRIST IDAG");
  // Startsidan: klientens namn och ärendenumret överst på raden (#1965).
  const matterNumber = seed.matters.find((m) => m.id === matterId)?.matterNumber ?? "";
  await expect(watchRow).toContainText(`${klient} · ${matterNumber}`);
  await expect(page.getByRole("heading", { name: /Tidrapportering/ })).toBeVisible();
  await expect(page.getByText("Att göra", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /🔔 Frister/ })).toBeVisible();
});

test("Radera: fristen försvinner ur ärendets Frister efter bekräftelse (#1231)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matterId = matterIdWith(seed, "timeEntries");

  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  const section = page.getByRole("region", { name: "Frister" }).last();
  await expect(section).toBeVisible({ timeout: 25_000 });

  const title = "E2E-frist: felaktig dom";
  await section.getByLabel("Frist", { exact: true }).fill(title);
  await section.getByLabel("Datum", { exact: true }).fill("2030-01-15");
  await section.getByRole("button", { name: "Lägg till" }).click();
  const row = section.locator("li", { hasText: title });
  await expect(row).toBeVisible();

  page.once("dialog", (d) => { void d.accept(); });
  await row.getByRole("button", { name: `Radera: ${title}` }).click();
  await expect(row).toHaveCount(0);
});

// ─── Ska ärendet markeras som avslutat? (#2100) ─────────────────────────────

/** Demoärendet utan tid sedan länge (rättsskydd, positivt besked), ur seeden. */
function staleMatter(seed: DemoSeed): { id: string; title: string } {
  const m = seed.matters.find((x) => x.matterNumber === "2026-0021");
  if (!m) throw new Error("seeden saknar ärende 2026-0021");
  return { id: m.id, title: m.title };
}

/** Sidan Att åtgärda med hela byrån, så att urvalet inte beror på vem demon loggar in som. */
async function openActionItems(page: Page, base: string): Promise<void> {
  await page.goto(`${base}/action-items/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: "Att åtgärda" })).toBeVisible({ timeout: 25_000 });
  const mine = page.getByLabel("Bara mina ärenden");
  if (await mine.isChecked()) await mine.uncheck();
}

const closeRow = (page: Page) =>
  page.locator("li", { hasText: "Ska ärendet markeras som avslutat?" }).filter({ hasText: "2026-0021" });

test("Att åtgärda frågar om ett ärende utan tid ska avslutas; Avsluta, Återöppna och Behåll som aktivt (#2100)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  const matter = staleMatter(seed);

  await openActionItems(page, base);
  const row = closeRow(page);
  await expect(row).toBeVisible({ timeout: 25_000 });
  await expect(row).toContainText(/Ingen tid registrerad sedan \d{4}-\d{2}-\d{2}\./);

  // Avsluta ärendet: samma fråga som i ärendet, med ärendets titel.
  let question = "";
  page.once("dialog", (d) => { question = d.message(); void d.accept(); });
  await row.getByRole("button", { name: "Avsluta ärendet" }).click();
  await expect(row).toHaveCount(0);
  expect(question).toBe(`Avsluta ärendet "${matter.title}"? Det går att återöppna sen.`);

  await page.goto(`${base}/matters/${matter.id}/`, { waitUntil: "load" });
  const header = page.getByTestId("matter-header");
  await expect(header.getByText("Stängt", { exact: true })).toBeVisible({ timeout: 25_000 });

  // Återöppna: frågan finns igen.
  await header.getByRole("button", { name: "Återöppna" }).click();
  await expect(header.getByText("Aktivt", { exact: true })).toBeVisible();
  await openActionItems(page, base);
  await expect(closeRow(page)).toBeVisible({ timeout: 25_000 });

  // Behåll som aktivt: posten är borta, också efter en omladdning.
  await closeRow(page).getByRole("button", { name: "Behåll som aktivt" }).click();
  await expect(closeRow(page)).toHaveCount(0);
  await page.reload({ waitUntil: "load" });
  await openActionItems(page, base);
  await expect(page.getByText(/\d+ poster\./)).toBeVisible({ timeout: 25_000 });
  await expect(closeRow(page)).toHaveCount(0);
});

// ─── Ett slutligt avgörande ger samma fråga (#2101) ─────────────────────────

/** HD:s protokoll som inte meddelar prövningstillstånd (känns igen av #2099). */
const HD_PROTOKOLL = [
  "HÖGSTA DOMSTOLEN PROTOKOLL",
  "Mål nr B 2020-24",
  "BESLUT",
  "Högsta domstolen meddelar inte prövningstillstånd. Hovrättens avgörande står därmed fast.",
].join("\n");

const rulingRow = (page: Page) =>
  page.locator("li", { hasText: "Ska ärendet markeras som avslutat?" }).filter({ hasText: "2026-0012" });

test("ett uppladdat beslut från HD ger frågan om avslut med dokumentet som skäl (#2101)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedDemoLogin(page, base);
  const seed = await fetchDemoSeed(page, base);
  // Aktivt och skapat 5 dagar före bygget: tidsregeln kan inte ge det en post.
  const matter = seed.matters.find((m) => m.matterNumber === "2026-0012");
  if (!matter) throw new Error("seeden saknar ärende 2026-0012");

  await openActionItems(page, base);
  await expect(page.getByText(/\d+ poster\./)).toBeVisible({ timeout: 25_000 });
  await expect(rulingRow(page)).toHaveCount(0);

  await page.goto(`${base}/matters/${matter.id}/`, { waitUntil: "load" });
  await showPanel(page, "Dokument");
  await page.locator("input[type=file]").setInputFiles({
    name: "hd-protokoll.txt", mimeType: "text/plain", buffer: Buffer.from(HD_PROTOKOLL, "utf8"),
  });
  const dialog = page.getByRole("dialog", { name: "Namnge dokumentet" });
  await expect(dialog.getByRole("textbox")).toHaveValue("hd-protokoll");
  await dialog.getByRole("button", { name: "Spara" }).click();
  await expect(page.getByText("hd-protokoll.txt").first()).toBeVisible({ timeout: 30_000 });

  // Igenkänningen körs i fliken efter uppladdningen. Via menyn (klient-navigering),
  // inte en omladdning, som skulle avbryta den; listan läses om tills posten finns.
  await page.getByRole("link", { name: /Att åtgärda/ }).first().click();
  await expect(page.getByRole("heading", { name: "Att åtgärda" })).toBeVisible({ timeout: 25_000 });
  const mine = page.getByLabel("Bara mina ärenden");
  if (await mine.isChecked()) await mine.uncheck();
  await expect(rulingRow(page)).toContainText(
    "hd-protokoll.txt ser ut att vara ett beslut från Högsta domstolen att inte meddela prövningstillstånd.",
    { timeout: 30_000 },
  );
  await expect(rulingRow(page)).not.toContainText("Ingen tid registrerad sedan");
  await expect(rulingRow(page).getByRole("button", { name: "hd-protokoll.txt" })).toBeVisible();

  // Behåll som aktivt: dokumentet ger inget nytt skäl.
  await rulingRow(page).getByRole("button", { name: "Behåll som aktivt" }).click();
  await expect(rulingRow(page)).toHaveCount(0);
  await page.reload({ waitUntil: "load" });
  await openActionItems(page, base);
  await expect(page.getByText(/\d+ poster\./)).toBeVisible({ timeout: 25_000 });
  await expect(rulingRow(page)).toHaveCount(0);
});
