/**
 * E2E (demo): visningsfel från genomgången av alla menyer (#1309).
 *
 * - Anteckningar: rå ISO-tidpunkt i Datum (demogeneratorn skickade den som `date`).
 * - Fakturor: typen "CREDIT" i stället för "Kreditfaktura".
 * - Avbetalningar: radens status "AKTIVA" (filterknappens plural).
 * - Användare: "2.50 kr/km" med decimalpunkt; nu kr/mil med decimalkomma (#1527).
 * - Fakturor: annullerade och kreditfakturor dolda från början (#1522).
 * - Ärendet: fliken Betalningssätt borta, ändras via huvudet (#1499).
 * - Rutornas rubrikrader: ett steg starkare färg i ljust läge, mörkt läge oförändrat (#1636).
 * - Startsidan: tidsumman i Tidrapportering ser ut som rubriken (#1673).
 * - Fakturor: förfallna fakturor markeras röda och knappen visar bara dem (#1731).
 * - Avbetalningar: påminnelser registreras, AVA säger inte att de skickas (#2135).
 * - Avbetalningar: planer som ligger efter markeras "Förfallen N dagar" (#2136).
 * - Att åtgärda: en rad per plan som ligger efter, som öppnar planen (#2137).
 */
import type { Locator, Page } from "@playwright/test";
import { paymentPlanOverdue, type PlanOverdueInput } from "../../src/lib/shared/payment-plan-overdue";
import { DEMO_BASE_URL as BASE, fetchDemoSeed, seedDemoLogin, showPanel, test, expect } from "./_demo-test";

const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await seedDemoLogin(page, BASE);
});

test("ärendenas anteckningar visar dag och klockslag, aldrig en rå ISO-tidpunkt", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  // Ärenden med fakturor har anteckningar från fakturaflödet och generatorn.
  const matterIds = [...new Set(seed.invoices.map((i) => i.matterId))].slice(0, 4);
  for (const id of matterIds) {
    await page.goto(`${BASE}/matters/${id}/`);
    await showPanel(page, "Anteckningar");
    const notes = page.getByRole("region", { name: "Anteckningar" }).last();
    await expect(notes.getByRole("row").nth(1)).toBeVisible({ timeout: 30_000 });
    expect(await notes.innerText(), id).not.toMatch(ISO_TIMESTAMP);
  }
});

test("Fakturor, Avbetalningar och Användare visar svenska etiketter", async ({ page }) => {
  await page.goto(`${BASE}/invoices/`);
  // Kreditfakturor är dolda från början (#1522).
  await page.getByRole("button", { name: /^Visa annullerade \(\d+\)$/ }).click({ timeout: 30_000 });
  await expect(page.getByText("Kreditfaktura").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("CREDIT", { exact: true })).toHaveCount(0);

  await page.goto(`${BASE}/payment-plans/`);
  await expect(page.getByRole("cell", { name: "Aktiv", exact: true }).first()).toBeVisible({ timeout: 30_000 });

  await page.goto(`${BASE}/users/`);
  await expect(page.getByText(/^\d+,\d{2}\s?kr\/mil$/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d\.\d{2}\s?kr\/mil|kr\/km/)).toHaveCount(0);
});

test("Avbetalningar: påminnelserna registreras, ingenting sägs vara skickat (#2135)", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  await page.goto(`${BASE}/payment-plans/`);
  await expect(page.getByRole("button", { name: "Registrera påminnelser" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Skicka påminnelser/)).toHaveCount(0);

  // Demons aktiva planer med påminnelser (seedens withReminders): minst en visar "Registrerad".
  let registered = 0;
  for (const plan of seed.paymentPlans.filter((p) => p.status === "ACTIVE")) {
    await page.goto(`${BASE}/payment-plans/${plan.id}/`);
    await showPanel(page, "Påminnelser");
    const panel = page.getByRole("region", { name: "Påminnelser" }).last();
    await expect(panel.getByText(/Registrerad |Inga påminnelser registrerade än\./).first()).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText(/Skickad|skickade/)).toHaveCount(0);
    registered += await panel.getByText(/^Registrerad /).count();
  }
  expect(registered).toBeGreaterThan(0);
});

test("fakturalistan markerar förfallna fakturor och knappen visar bara de markerade (#1731)", async ({ page }) => {
  await page.goto(`${BASE}/invoices/`);
  const overdue = /^Förfallen \d+ dag(ar)?$/;
  // Demodatat har fakturor med förfallodag långt bak i tiden (t.ex. 2025).
  await expect(page.getByText(overdue).first()).toBeVisible({ timeout: 30_000 });
  const button = page.getByRole("button", { name: "Förfallna och ej framkomna" });
  await expect(button).toHaveAttribute("aria-pressed", "false");
  const allRows = await page.locator("tbody tr").count();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  const rows = page.locator("tbody tr");
  const marked = await rows.count();
  expect(marked).toBeGreaterThan(0);
  expect(marked).toBeLessThan(allRows);
  for (let n = 0; n < marked; n++) {
    await expect(rows.nth(n).getByText(/^(Förfallen \d+ dag(ar)?|Kom inte fram)$/).first()).toBeVisible();
  }
  await button.click();
  await expect(rows).toHaveCount(allRows);
});

// Betalningssättet i ärendehuvudet (#1518): etikett, försäkringsbolag (vid
// rättsskydd) och klientens andel, på raden under titeln.
const PAYMENT_LINES = [
  // Rättsskydd där försäkringsbolaget är motpart: inget bolag visas, ingen andel satt.
  { matterNumber: "2026-0012", text: "· Rättsskydd" },
  // Rättsskydd, självrisk 20 %, inget försäkringsbolag som kontakt.
  { matterNumber: "2026-0021", text: "· Rättsskydd · klienten betalar 20 %" },
  // Rättshjälp med 40 % klientandel.
  { matterNumber: "2026-0010", text: "· Rättshjälp · klienten betalar 40 %" },
] as const;

for (const { matterNumber, text } of PAYMENT_LINES) {
  test(`ärendehuvudet visar betalningssättet: ${text}`, async ({ page }) => {
    const seed = await fetchDemoSeed(page, BASE);
    const matter = seed.matters.find((m) => m.matterNumber === matterNumber);
    expect(matter, matterNumber).toBeDefined();
    await page.goto(`${BASE}/matters/${matter?.id ?? ""}/`);
    await expect(page.getByTestId("matter-payment-line")).toHaveText(text, { timeout: 30_000 });
  });
}

// Fliken Betalningssätt är borta (#1499): "Ändra" i huvudet öppnar ärendedialogen (#1565).
test("ingen flik Betalningssätt; betalningssättet ändras via ärendehuvudet (#1499)", async ({ page }) => {
  const seed = await fetchDemoSeed(page, BASE);
  const matter = seed.matters.find((m) => m.matterNumber === "2026-0010");
  expect(matter).toBeDefined();
  await page.goto(`${BASE}/matters/${matter?.id ?? ""}/`);
  const line = page.getByTestId("matter-payment-line");
  await expect(line).toHaveText("· Rättshjälp · klienten betalar 40 %", { timeout: 30_000 });
  await expect(page.getByRole("tab", { name: /^Tid/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Betalningssätt/ })).toHaveCount(0);

  await page.getByTestId("matter-header").getByRole("button", { name: "Ändra ärende" }).click();
  const dialog = page.getByRole("dialog", { name: "Ändra ärende" });
  await dialog.getByLabel("Betalningssätt", { exact: true }).selectOption("PRIVAT");
  await dialog.getByRole("button", { name: "Spara", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(line).toHaveText("· Klient betalar allt själv", { timeout: 15_000 });
});

test("Fakturor döljer annullerade och kreditfakturor tills man väljer att visa dem (#1522)", async ({ page }) => {
  await page.goto(`${BASE}/invoices/`);
  const show = page.getByRole("button", { name: /^Visa annullerade \(\d+\)$/ });
  await expect(show).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("cell", { name: "Kreditfaktura", exact: true })).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "Annullerad", exact: true })).toHaveCount(0);

  await show.click();
  await expect(page.getByRole("cell", { name: "Kreditfaktura", exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Dölj annullerade" }).click();
  await expect(page.getByRole("cell", { name: "Kreditfaktura", exact: true })).toHaveCount(0);
});

// ── #1636: rubrikradernas färg ──────────────────────────────────────────────

/** Rubrikradens beräknade färger: bakgrund, kant (överkant) och vänsterkant. */
async function headerColors(header: Locator): Promise<[string, string, string]> {
  return header.evaluate((el) => {
    const s = getComputedStyle(el);
    return [s.backgroundColor, s.borderTopColor, s.borderLeftColor];
  });
}

/** Samma färger på ett provelement med Tailwind-klasserna (ljust läge: ingen `.dark`). */
async function probeColors(page: Page, classes: readonly string[]): Promise<[string, string, string]> {
  return page.evaluate((cls) => {
    const probe = document.createElement("div");
    probe.className = `${cls.join(" ")} border border-l-4`;
    document.body.append(probe);
    const s = getComputedStyle(probe);
    const out: [string, string, string] = [s.backgroundColor, s.borderTopColor, s.borderLeftColor];
    probe.remove();
    return out;
  }, [...classes]);
}

/**
 * Lägsta WCAG-kontrast mellan rubrikradens text (rubrik, summor, länkar) och
 * radens bakgrund. Färgerna tolkas via canvas, så oklch/lab fungerar också.
 */
async function minTextContrast(header: Locator): Promise<number> {
  return header.evaluate((el) => {
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (!ctx) return 0;
    const lum = (color: string): number => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      const lin = (v: number): number => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const bg = lum(getComputedStyle(el).backgroundColor);
    const ownText = (n: Element): boolean => [...n.childNodes].some((c) => c.nodeType === Node.TEXT_NODE && (c.textContent ?? "").trim() !== "");
    const ratios = [...el.querySelectorAll("*")].filter(ownText).map((n) => {
      const fg = lum(getComputedStyle(n).color);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    return Math.min(...ratios);
  });
}

const START_HEADERS = [
  { tone: "amber", heading: /Frister/, light: ["bg-amber-200", "border-amber-300", "border-l-amber-600"],
    dark: ["rgba(245, 158, 11, 0.28)", "rgba(245, 158, 11, 0.4)", "rgba(245, 158, 11, 0.4)"] },
  { tone: "indigo", heading: /Tidrapportering/, light: ["bg-indigo-200", "border-indigo-300", "border-l-indigo-600"],
    dark: ["rgba(99, 102, 241, 0.28)", "rgba(99, 102, 241, 0.4)", "rgba(99, 102, 241, 0.4)"] },
  { tone: "gray", heading: /Senaste ärenden/, light: ["bg-gray-200", "border-gray-300", "border-l-gray-500"],
    dark: ["rgb(51, 65, 85)", "rgb(51, 65, 85)", "rgb(51, 65, 85)"] },
] as const;

/** Startsidans rubrikrad med given ton och rubrik. */
function startHeader(page: Page, tone: string, heading: RegExp): Locator {
  return page.locator(`.section-tone-${tone}`).filter({ has: page.getByRole("heading", { name: heading }) }).first();
}

test("Startsidan i ljust läge: rubrikraderna har den starkare tonen och läsbar text", async ({ page }) => {
  await page.goto(`${BASE}/`);
  for (const h of START_HEADERS) {
    const header = startHeader(page, h.tone, h.heading);
    await expect(header).toBeVisible({ timeout: 30_000 });
    expect(await headerColors(header), h.tone).toEqual(await probeColors(page, h.light));
    expect(await minTextContrast(header), h.tone).toBeGreaterThanOrEqual(4.5);
  }
});

/** Tidsumman `(X h)` i Tidrapporteringens rubrik, och rubriken själv (#1673). */
async function timeSumLook(page: Page): Promise<{ sum: string[]; heading: string[] }> {
  const heading = page.getByRole("heading", { name: /^Tidrapportering/ });
  await expect(heading).toBeVisible({ timeout: 30_000 });
  const sum = heading.locator("span").filter({ hasText: /^\(.+ h\)$/ });
  await expect(sum).toBeVisible();
  const look = (l: Locator) => l.evaluate((el) => { const s = getComputedStyle(el); return [s.fontWeight, s.fontSize, s.color]; });
  return { sum: await look(sum), heading: await look(heading) };
}

test("Startsidan: tidsumman i Tidrapportering ser ut som rubriken (#1673)", async ({ page }) => {
  await page.goto(`${BASE}/`);
  const { sum, heading } = await timeSumLook(page);
  expect(sum[0]).toBe("600");
  expect(sum).toEqual(heading);
});

test.describe("mörkt läge", () => {
  test.use({ colorScheme: "dark" });

  test("Startsidan: tidsumman följer rubrikens färg (#1673)", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    const { sum, heading } = await timeSumLook(page);
    expect(sum).toEqual(heading);
  });

  test("Startsidans rubrikrader har samma färger som före #1636", async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    for (const h of START_HEADERS) {
      const header = startHeader(page, h.tone, h.heading);
      await expect(header).toBeVisible({ timeout: 30_000 });
      expect(await headerColors(header), h.tone).toEqual([...h.dark]);
    }
    // Andra element med samma klasser behåller sina mörka värden (.dark .bg-gray-200 m.fl.).
    const [bg, border] = await probeColors(page, ["bg-gray-200", "border-gray-300", "border-l-gray-500"]);
    expect([bg, border]).toEqual(["rgb(71, 85, 105)", "rgb(71, 85, 105)"]);
  });
});

/** Seedens fält som Avbetalningars markering räknar på (#2136). */
interface PlanSeed {
  matters: Array<{ id: string; matterNumber?: string }>;
  invoices: Array<{ id: string; matterId: string; amount?: number }>;
  payments: Array<{ invoiceId: string; amount: number }>;
  writeOffs?: Array<{ invoiceId: string; amount: number }>;
  paymentPlans: Array<PlanOverdueInput & { id: string; invoiceId: string }>;
}

/** De aktiva planernas ärendenummer, och om planen ligger efter enligt den delade regeln. */
function activePlans(seed: PlanSeed, now: Date): Array<{ id: string; matterNumber: string; behind: boolean }> {
  const ledger = (rows: PlanSeed["payments"] | undefined, id: string) => (rows ?? []).filter((r) => r.invoiceId === id);
  return seed.paymentPlans.filter((p) => p.status === "ACTIVE").map((p) => {
    const inv = seed.invoices.find((i) => i.id === p.invoiceId);
    const invoice = { amount: inv?.amount ?? null, payments: ledger(seed.payments, p.invoiceId), writeOffs: ledger(seed.writeOffs, p.invoiceId) };
    const matterNumber = seed.matters.find((m) => m.id === inv?.matterId)?.matterNumber ?? "";
    return { id: p.id, matterNumber, behind: paymentPlanOverdue({ ...p, invoice }, now) !== null };
  });
}

// Demons planer kommer ur demogeneratorn och startar nära byggdagen, så ingen
// behöver ligga efter. Testet håller sidan och regeln ihop åt båda hållen:
// en plan som ligger efter har markeringen, en som är ikapp har den inte.
test("Avbetalningar: markeringen Förfallen N dagar följer den delade regeln (#2136)", async ({ page }) => {
  const res = await page.request.get(`${BASE}/demo-seed.json`);
  const plans = activePlans(await res.json() as PlanSeed, new Date());
  expect(plans.length).toBeGreaterThan(0);
  await page.goto(`${BASE}/payment-plans/`);
  await expect(page.getByRole("cell", { name: "Aktiv", exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const overdue = /^Förfallen \d+ dag(ar)?$/;
  for (const p of plans) {
    const row = page.locator("tbody tr").filter({ hasText: p.matterNumber }).first();
    await expect(row.getByText(overdue), p.matterNumber).toHaveCount(p.behind ? 1 : 0);
  }
});

// Demons planer startar nära byggdagen (se ovan), så webbläsarens klocka ställs
// 150 dagar fram: då ligger de aktiva planerna efter. Varje plan som ligger
// efter enligt den delade regeln har sin rad, och ett klick öppnar planen (#2137).
test("Att åtgärda: Delbetalning förfallen för planerna som ligger efter, och raden öppnar planen (#2137)", async ({ page }) => {
  const later = new Date(Date.now() + 150 * 86_400_000);
  const seed = await (await page.request.get(`${BASE}/demo-seed.json`)).json() as PlanSeed;
  const plans = activePlans(seed, later).filter((p) => p.behind);
  expect(plans.length).toBeGreaterThan(0);
  await page.clock.setFixedTime(later);
  await page.goto(`${BASE}/action-items/`);
  await expect(page.getByRole("heading", { name: "Att åtgärda" })).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Bara mina ärenden").uncheck();
  const rowFor = (matterNumber: string) =>
    page.getByRole("link").filter({ hasText: /Delbetalning förfallen \d+ dag(ar)?/ }).filter({ hasText: matterNumber });
  for (const p of plans) await expect(rowFor(p.matterNumber), p.matterNumber).toHaveCount(1, { timeout: 30_000 });
  const first = plans[0];
  await rowFor(first?.matterNumber ?? "").click();
  await expect(page).toHaveURL(new RegExp(`/payment-plans/.*${first?.id ?? "-"}`), { timeout: 30_000 });
});
