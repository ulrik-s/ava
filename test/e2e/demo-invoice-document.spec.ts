/**
 * E2E (demo): exakt det rapporterade flödet, helt automatiserat.
 *
 *   Logga in som "Anna Advokat" → Ärenden → "Brottmål — ekobrott Carlsson"
 *   → klicka "Faktura"-länken i kostnadsräkningsraden → på fakturasidan,
 *   klicka dokumentnamnet "Faktura ….pdf" i Fakturadokument-panelen.
 *
 * Förväntat: PDF:en öppnas i en SEPARAT FLIK. Buggen var att man istället
 * dirigerades in i ärendet (dokumentnamnet länkade till /matters) — ofta med
 * React #418 på köpet. Testet failar om man navigeras till /matters eller om
 * #418 dyker upp.
 *
 * Kör mot en lokalt serverad `out/` (default — configen startar servern) eller
 * mot den deployade demon:
 *   bun run build:demo && bun run e2e:demo
 *   AVA_DEMO_BASE_URL=https://ulrik-s.github.io/ava bun run e2e:demo
 *
 * `test` kommer från `_demo-test` → varje förfrågan utanför testets egen origin
 * blockeras och fäller testet (#932).
 */
import { type ConsoleMessage, type Page } from "@playwright/test";

import { DEMO_BASE_URL, fetchDemoSeed, seedDemoConfig, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

// Seed-identiteter (ur .ava/meta.json). "Logga in som Anna" = seedad config.
const ANNA = "e1c7d494-c148-5998-b717-df386937d5a1";
const ORG = "83f68f9a-5f27-5199-b54b-e4b2fa380e14";
const MATTER = "92d63776-c955-54dc-8430-3573bed7829b"; // Brottmål — ekobrott Carlsson

test("fakturadokument öppnas i ny flik — dirigeras INTE in i ärendet (+ ingen #418)", async ({ page, context, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");

  // "Logga in som Anna Advokat" — seeda demo-config (samma som /login skriver).
  await seedDemoConfig(context, {
    principalId: ANNA, organizationId: ORG,
    authorName: "Anna Advokat", authorEmail: "user@ava.demo",
  });

  const hydrationErrors: string[] = [];
  page.on("console", (m: ConsoleMessage) => {
    if (/#418|Minified React error 418|Hydration failed/i.test(m.text())) hydrationErrors.push(m.text());
  });
  page.on("pageerror", (e) => { if (/#418|418/.test(e.message)) hydrationErrors.push(e.message); });

  // Ärendet (Brottmål — ekobrott Carlsson).
  await page.goto(`${base}/matters/${MATTER}/`, { waitUntil: "load" });
  await expect(page.getByRole("heading", { name: /ekobrott Carlsson/i })).toBeVisible({ timeout: 30_000 });
  await showPanel(page, "Fakturering");

  // Ärendets kostnadsräkning är redan avgjord och fakturerad i seeden, så
  // fakturan finns när sidan öppnas. Vägen dit — "Registrera beslut" → "Skapa
  // faktura" — körs skarpt i `demo-kostnadsrakning-verdict.spec.ts` på det
  // ärende som väntar på dom. (Här stod förr en gren som letade efter en knapp
  // "Ange dom + prutning". Den etiketten renderades aldrig av något, så grenen
  // hoppades tyst över vid varje körning — se #996.)

  // No-reload-markör: överlever en SPA-övergång men nollas vid sidomladdning.
  await page.evaluate(() => { (window as unknown as { __avaSpa?: string }).__avaSpa = "alive"; });

  // "Faktura"-länken längst till höger i kostnadsräkningsraden → fakturasidan.
  const fakturaLink = page.locator('main a[href*="/invoices/"]').first();
  await expect(fakturaLink).toBeVisible({ timeout: 15_000 });
  await fakturaLink.click();
  await expect(page).toHaveURL(/\/invoices\//, { timeout: 20_000 });
  await page.waitForTimeout(4000); // bootstrap + rehydrering av genererat dokument

  // Navigeringen ska ha varit en SOFT SPA-övergång (ingen omladdning → inget blink).
  const survivedNav = await page.evaluate(() => (window as unknown as { __avaSpa?: string }).__avaSpa);
  expect(survivedNav, "navigering till fakturan ska vara soft (ingen sidomladdning)").toBe("alive");

  // Fakturadokument-panelen: dokumentnamnet "Faktura ….pdf". Lokalisera via TEXT
  // så det fångar både den BUGGIGA varianten (en <a>-länk till /matters) och den
  // FIXADE (en <button> som öppnar dokumentet).
  //
  // Fakturadokumenten är PDF:er sedan #1439 (var `.html` under #937–#1439). Kör
  // testet mot en lokalt byggd `out/` — mot den deployade demon testar det den
  // builden, inte koden i repot (#932).
  await showPanel(page, "Fakturadokument"); // bakgrundsflik på fakturasidan (#1184)
  const docEl = page.getByText(/Faktura .*\.pdf/i).first();
  await expect(docEl).toBeVisible({ timeout: 15_000 });

  const urlBeforeClick = page.url();

  // Klick ska öppna dokumentet i NY FLIK (popup) — inte navigera huvudsidan in i
  // ärendet. (Buggen: namnet var en länk till /matters → hård-nav dit.)
  const popupPromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
  await docEl.click();
  const popup = await popupPromise;

  // KÄRN-ASSERTIONS:
  // 1) Huvudsidan ska INTE ha navigerat in i ärendet.
  expect(page.url(), "huvudsidan ska stanna på fakturasidan, inte gå till /matters").not.toMatch(/\/matters\//);
  expect(page.url()).toBe(urlBeforeClick);
  // 2) En ny flik (dokumentet) ska ha öppnats.
  expect(popup, "dokumentet ska öppnas i en ny flik").not.toBeNull();
  // 3) Ingen hydrerings-#418.
  expect(hydrationErrors, `React #418 / hydrerings-fel: ${hydrationErrors.join(" | ")}`).toEqual([]);
});

/** Svenska kalenderdagar (ÅÅÅÅ-MM-DD) i postlistans rader. */
const DAY_RE = /\d{4}-\d{2}-\d{2}/;
/** Den äldre tidspostens dag — före allt ofakturerat i seeden. */
const OLD_DAY = "2026-01-15";
const OLD_POST = "E2E: äldre genomgång (#1888)";

/** Första aktiva privata ärendet (id-sorterat → stabilt) med ofrysta tidsposter. */
function privatMatterWithPosts(seed: Awaited<ReturnType<typeof fetchDemoSeed>>): string {
  const hasPosts = (id: string): boolean => seed.timeEntries.some((t) => t.matterId === id && !t.frozenAt && !t.invoiceId);
  const hit = seed.matters.filter((m) => m.paymentMethod === "PRIVAT" && m.status === "ACTIVE")
    .map((m) => m.id).sort().find(hasPosts);
  if (hit === undefined) throw new Error("seeden saknar ett aktivt privat ärende med ofrysta tidsposter");
  return hit;
}

test("faktura med datumintervall: bara posterna inom intervallet faktureras (#1888)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  const matterId = privatMatterWithPosts(await fetchDemoSeed(page, base));

  // En tidspost på en äldre dag, så att intervallet delar listan.
  await page.goto(`${base}/matters/${matterId}/`, { waitUntil: "load" });
  const tid = page.getByRole("region", { name: "Tid" }).last();
  await expect(tid).toBeVisible({ timeout: 25_000 });
  await tid.getByRole("button", { name: /Registrera tid/ }).click();
  const timeDialog = page.getByRole("dialog", { name: "Registrera tid" });
  await timeDialog.getByLabel("Datum *").fill(OLD_DAY);
  await timeDialog.getByLabel("Beskrivning *").fill(OLD_POST);
  await timeDialog.locator("button[type=submit]").click();
  await expect(timeDialog).toHaveCount(0);
  await expect(tid.getByText(OLD_POST)).toBeVisible();
  // Fakturaförslaget hämtades innan posten fanns: ladda om (demon sparar lokalt).
  await page.reload({ waitUntil: "load" });

  await showPanel(page, "Fakturering");
  const openDialog = async () => {
    await page.getByRole("button", { name: "+ Skapa faktura" }).click({ timeout: 30_000 });
    await page.getByRole("button", { name: "Faktura till klient" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/Poster att fakturera/)).toBeVisible({ timeout: 15_000 });
    return dialog;
  };

  const dialog = await openDialog();
  await expect(dialog.getByText(OLD_POST)).toBeVisible();
  const rows = dialog.locator("label").filter({ has: page.getByRole("checkbox") }).filter({ hasText: DAY_RE });
  const days = (await rows.allTextContents()).map((t) => DAY_RE.exec(t)?.[0] ?? "");
  const total = days.length;
  const inRange = days.filter((d) => d <= OLD_DAY).length;
  expect(inRange).toBeGreaterThan(0);
  expect(inRange, "intervallet ska dela listan").toBeLessThan(total);

  await dialog.getByLabel("Till och med").fill(OLD_DAY);
  await expect(dialog.getByText(`Poster att fakturera (${inRange}/${total} valda)`)).toBeVisible();
  await dialog.getByRole("button", { name: "Skapa faktura" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  // Posterna inom intervallet är frysta på fakturan; de övriga står kvar ofakturerade.
  const after = await openDialog();
  const left = total - inRange;
  await expect(after.getByText(`Poster att fakturera (${left}/${left} valda)`)).toBeVisible({ timeout: 15_000 });
  await expect(after.getByText(OLD_POST)).toHaveCount(0);
});

// #1941: två aconton i ett rättshjälpsärende, skapade i dialogen Aconto till
// klient. Den andra fakturans sida visar den sparade nedbrytningen (#1940):
// klientens rättshjälpsavgift och avdraget för det första acontot, och ingen
// Justering när förslaget inte ändrats. Fakturans dokument finns i
// Fakturadokument-panelen. Att dokumentet får nedbrytningen täcks av
// komponenttestet (`billing-dialog.test.tsx`); PDF:ens text läses inte här.
// Seeden har inget rättshjälpsärende i fasen ARBETE, så testet skapar sitt eget.

/** Nytt ärende med betalningssättet rättshjälp; sidan står på ärendet efteråt. */
async function newLegalAidMatter(page: Page, base: string): Promise<void> {
  const title = `Aconto e2e ${Date.now()}`;
  await page.goto(`${base}/matters/?new=1`, { waitUntil: "load" });
  await page.getByLabel("Titel *").fill(title);
  await page.getByRole("button", { name: "Skapa ärende" }).click();
  await expect(page.getByLabel("Titel *")).toHaveCount(0);
  await page.getByRole("row").filter({ hasText: title }).getByRole("link", { name: title }).click();
  const header = page.getByTestId("matter-header");
  await header.getByRole("button", { name: "Ändra ärende" }).click({ timeout: 25_000 });
  const edit = page.getByRole("dialog", { name: "Ändra ärende" });
  await edit.getByLabel("Betalningssätt").selectOption("RATTSHJALP");
  await edit.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(edit).toBeHidden();
}

/** En tidspost med dialogens standardtid. */
async function registerTime(page: Page, description: string): Promise<void> {
  await showPanel(page, "Tid");
  await page.getByRole("region", { name: "Tid" }).last().getByRole("button", { name: /Registrera tid/ }).click();
  const dialog = page.getByRole("dialog", { name: "Registrera tid" });
  await dialog.getByLabel("Beskrivning *").fill(description);
  await dialog.locator("button[type=submit]").click();
  await expect(dialog).toHaveCount(0);
}

/** Ett utlägg på 400 kr exkl moms med 25 % moms. */
async function registerExpense(page: Page): Promise<void> {
  await showPanel(page, "Utlägg");
  await page.getByRole("button", { name: "+ Nytt utlägg" }).click();
  const dialog = page.getByRole("dialog", { name: "Nytt utlägg" });
  await dialog.locator('input[inputmode="decimal"]').fill("400");
  await dialog.getByPlaceholder("Beskrivning *").fill("E2E: resa med moms");
  await dialog.locator("select").selectOption("2500");
  await dialog.getByRole("button", { name: "Spara" }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Aconto till klient med det ifyllda förslaget. Sidan laddas om först: förslaget
 * hämtas inte om när tid eller utlägg registreras (cachen håller i 60 s), och
 * ett inaktuellt förslag ger en Justering-rad. Det felet är inte #1941:s.
 */
async function createAcconto(page: Page): Promise<void> {
  await page.reload({ waitUntil: "load" });
  await expect(page.getByTestId("matter-header")).toBeVisible({ timeout: 25_000 });
  await showPanel(page, "Fakturering");
  await page.getByRole("button", { name: "+ Skapa faktura" }).click();
  await page.getByRole("button", { name: "Aconto till klient" }).click();
  const dialog = page.getByRole("dialog", { name: "Aconto till klient" });
  await expect(dialog.getByText(/Ändra bara beloppet i undantagsfall/)).toBeVisible();
  await dialog.getByRole("button", { name: "Skapa aconto-faktura" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 25_000 });
}

test("andra acontot: nedbrytningen med avdraget för det första, ingen Justering, och dokumentet finns (#1941)", async ({ page, baseURL }) => {
  const base = (baseURL ?? DEMO_BASE_URL).replace(/\/+$/, "");
  await seedDemoLogin(page, base);
  await newLegalAidMatter(page, base);
  // Rådgivningsfakturan skapas av sig själv i rättshjälp (#839); vänta in den
  // så att acontona räknas på arbetet efter den.
  await showPanel(page, "Fakturering");
  await expect(page.locator('main a[href*="/invoices/"]')).toHaveCount(1, { timeout: 25_000 });

  await registerTime(page, "E2E: inläsning");
  await registerExpense(page);
  await createAcconto(page);
  await registerTime(page, "E2E: möte");
  await createAcconto(page);

  // Acontonas fakturanummer i Fakturering — det andra acontot har det högsta.
  await showPanel(page, "Fakturering");
  const links = page.getByRole("row").filter({ hasText: "Aconto" }).locator('a[href*="/invoices/"]');
  await expect(links).toHaveCount(2, { timeout: 25_000 });
  const numbers = (await links.allTextContents()).map((t) => t.match(/F-\d{4}-\d+/)?.[0] ?? "").sort();
  const [first, second] = numbers;
  await links.filter({ hasText: second ?? "" }).first().click();
  await expect(page).toHaveURL(/\/invoices\//, { timeout: 20_000 });

  const body = page.locator("body");
  await expect(body).toContainText("Klientens rättshjälpsavgift", { timeout: 25_000 });
  await expect(body).toContainText(`Avgår aconto — faktura ${first ?? ""}`);
  await expect(body).not.toContainText("Justering");

  await showPanel(page, "Fakturadokument");
  await expect(page.getByText(/Faktura .*\.pdf/i).first()).toBeVisible({ timeout: 25_000 });
});
