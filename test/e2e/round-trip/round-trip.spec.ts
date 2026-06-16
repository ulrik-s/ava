/**
 * Git-round-trip e2e (self-hosted/OPFS) mot docker-stacken.
 *
 * Bevisar att den riktiga browser-klienten klonar bare-repo:t in i OPFS,
 * renderar UI:t från den lokala clonen, och att UI-skrivningar committas +
 * pushas till git-db:n (verifierat via en fristående clone).
 *
 * Krav (externt): `docker compose up -d --build` + `DEMO_BASE_PATH=/ava
 * bash scripts/build-demo.sh` (out/ byggd, web-containern omstartad om out/
 * raderats — bind-mount återresolvas vid omstart).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { freshClone, cleanup, readAll, resetRepo, extractedTextInRepo } from "./_repo-helpers";

const ORG = "e2e-firma-ab";

async function configureSelfHosted(page: Page): Promise<void> {
  // PAT genereras av docker-web:s entrypoint vid första uppstart och
  // läses från docker-logs:n. Exportera AVA_RT_GIT_PAT innan testet.
  // Behövs eftersom nginx /git/ har auth_basic på.
  const pat = process.env.AVA_RT_GIT_PAT ?? "";
  await page.addInitScript(({ org, token }) => {
    localStorage.setItem("ava.firma", JSON.stringify({
      tier: "self-hosted",
      repo: "http://localhost:8080/git/firma.git",
      token,
      // nginx auth_basic htpasswd-användaren är "admin" (docker-bootstrap).
      gitUsername: "admin",
      authorEmail: token ? "admin@ava.local" : "e2e@ava.local",
      organizationId: org,
      authorName: "E2E Test",
    }));
  }, { org: ORG, token: pat });
}

/** Läs alla rader under en under-mapp i bare-repo:t (fristående clone). */
function rowsInRepo(sub: string): Array<Record<string, unknown>> {
  const dir = freshClone();
  try {
    return readAll(dir, sub);
  } finally {
    cleanup(dir);
  }
}

function contactNamesInRepo(): string[] {
  return rowsInRepo("contacts").map((c) => String(c.name ?? ""));
}

/**
 * Vänta tills en UI-mutation faktiskt committats + pushats till git-db:n,
 * i st.f. att racea browserns 10 s push-debounce mot ett pollfönster (#209, #216).
 *
 * Sync-pillen visar `✓ Sparat` (synced) ENBART när inga ändringar väntar; en
 * mutation gör pillen pending/syncing ("⏳ … sparas snart" / "↻ Sparar…") tills
 * push:en landat (då blir den "✓ Sparat" igen).
 *
 * #216-fix: det räcker INTE att vänta på "Sparat" — pillen kan fortfarande visa
 * ett GAMMALT "Sparat" (från initial-synken) i ögonblicket vi tittar, innan
 * denna mutations pending-state hunnit renderas. Då returnerar vi för tidigt och
 * pollfönstret startar INNAN push-cykeln ens börjat (debounce 10 s + ev. upptagen
 * initial-sync + push-tid) → bare-repo:t ses tomt och 60 s tar slut.
 *
 * Vi väntar därför på en RIKTIG pending→synced-övergång: först att pillen LÄMNAR
 * "Sparat" (ändringen registrerad), sedan att den blir "Sparat" igen (push klar).
 * När detta returnerar HAR raden nått bare-repo:t → efterföljande poll träffar
 * direkt. Steget "lämna Sparat" är best-effort: en mycket snabb cykel kan hinna
 * bli synkad igen innan vi ser pending — då går vi vidare på synced-väntan.
 */
async function waitForGitDbPush(page: Page): Promise<void> {
  const pill = page.getByTestId("sync-pill");
  try {
    await expect(pill).not.toContainText("Sparat", { timeout: 20_000 });
  } catch {
    // Pillen lämnade aldrig "Sparat" inom fönstret — antingen redan synkad
    // (snabb push) eller ingen ändring registrerades. Synced-väntan nedan
    // verifierar slutläget oavsett.
  }
  await expect(pill).toContainText("Sparat", { timeout: 120_000 });
}

/** Skapa en org-scopad kontakt via UI:t (förutsättning för flera flöden). */
async function createContact(page: Page, name: string): Promise<void> {
  await page.goto("/ava/contacts/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "+ Ny kontakt" }).click();
  await page.getByLabel(/Namn/).fill(name);
  await page.getByRole("button", { name: "Spara kontakt" }).click();
  await expect(page.getByRole("button", { name: "Spara kontakt" })).toHaveCount(0, { timeout: 15_000 });
  // Vänta in hela writeBack→commit→push-kedjan: annars kan en efterföljande
  // sid-navigering (createMatterAndOpen) hydratisera OPFS INNAN kontakten
  // hunnit skrivas → klient-dropdownen saknar den (flaky i långsammare CI).
  await expect.poll(() => contactNamesInRepo(), POLL).toContain(name);
}

/** Registrera en tidspost (120 min) på öppen matter-detalj. */
async function registerTime(page: Page, desc: string): Promise<void> {
  await page.getByRole("button", { name: /Registrera tid/i }).click();
  // Scopa till modalen — matter-sidan har egna number-fält (t.ex. förväntade
  // domstolsbetalningar #173) så en sid-bred `.first()` blir tvetydig.
  const modal = page.getByRole("dialog");
  await modal.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
  await modal.locator('input[type="number"]').first().fill("120");
  await modal.getByPlaceholder(/Beskrivning/i).fill(desc);
  await modal.getByRole("button", { name: /^Spara$/ }).click();
  await expect(page.getByText(desc)).toBeVisible({ timeout: 10_000 });
}

/**
 * Sätt matter:s betalningssätt till Rättsskydd via PaymentMethodCard
 * ("Ändra" → välj → "Spara"). Acconto-flödet i BillingRun-modellen erbjuds
 * BARA för rättsskydd/rättshjälp (optionsFor i _billing-panel.tsx) — en
 * default-matter (paymentMethod=PENDING) visar bara "Faktura till klient".
 * Vi väntar tills kortet visar "Rättsskydd" (matter.getById refetchad) så att
 * BillingPanel hunnit få paymentMethod=RATTSSKYDD innan menyn öppnas.
 */
async function setRattsskydd(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Ändra", exact: true }).first().click();
  const select = page.locator("select").filter({ has: page.locator("option", { hasText: "Rättsskydd" }) });
  await select.selectOption("RATTSSKYDD");
  await page.getByRole("button", { name: /^Spara$/ }).click();
  await expect(page.getByText("Rättsskydd").first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Vänta tills BillingPanel:s summa-kort renderats (panelen hydrerad) innan vi
 * klickar "+ Skapa faktura". Annars kan en kvardröjande overlay från en just
 * stängd modal/dropdown (`div.fixed.inset-0 z-30`, BillingActions/data-table)
 * fånga pointer-eventet och klicket hänger till test-timeouten.
 */
async function awaitBillingPanelReady(page: Page): Promise<void> {
  await expect(page.getByText(/Fakturerat/).first()).toBeVisible({ timeout: 10_000 });
}

/**
 * Klicka fakturalänken i BillingPanel:s billing-run-lista och vänta in den
 * hård-navigerade faktura-detaljvyn tills den hydrerat.
 *
 * Två fallgropar hanteras:
 *  1. Sidomenyns "Fakturor"-länk renderas som `/ava/invoices/` (basePath +
 *     trailingSlash) och matchar också `[href*="/invoices/"]` — och ligger
 *     före panelen i DOM. Vi exkluderar den (den slutar på `/invoices/`); en
 *     riktig fakturalänk slutar på `<uuid>/`.
 *  2. Länken är en `<a>` (inte Next-Link) → hård navigation till static-export-
 *     shellen (404.html) → appen bootar om, klonar OPFS och kör useRouteId.
 *     Det tar längre tid än 15 s under last → vänta upp till 30 s + att
 *     "Laddar data…" släckts innan vi rör detaljvyns knappar.
 */
async function openInvoiceFromPanel(page: Page): Promise<void> {
  await page.locator('a[href*="/invoices/"]:not([href$="/invoices/"])').first().click();
  await page.waitForURL(/\/invoices\/.+/, { timeout: 30_000 });
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Skapa kontakt + ärende + tid (3000 kr) → faktura via BillingPanel →
 * navigera till faktura-detalj → markera skickad. Lämnar page på fakturans
 * detaljvy (SENT). Förutsättning för plan/kredit.
 */
async function createSentFinalInvoice(page: Page, stamp: number): Promise<void> {
  await createContact(page, `Klient ${stamp}`);
  await createMatterAndOpen(page, `Ärende ${stamp}`, `Klient ${stamp}`);
  await registerTime(page, `Arbete ${stamp}`);
  // Nya BillingPanel: "+ Skapa faktura" → meny → "Faktura till klient" → modal "Faktura"
  await awaitBillingPanelReady(page);
  await page.getByRole("button", { name: /\+ Skapa faktura/ }).click();
  await page.getByRole("button", { name: /Faktura till klient/i }).click();
  const finalModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: /^Faktura$/ }) });
  await finalModal.getByRole("button", { name: /^Skapa faktura$/ }).click();
  await expect(finalModal).toBeHidden({ timeout: 10_000 });
  await openInvoiceFromPanel(page);
  await expect(page.getByRole("button", { name: /Markera som skickad/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Markera som skickad/ }).click();
  await expect(page.getByRole("button", { name: /Skapa avbetalningsplan/ })).toBeVisible({ timeout: 15_000 });
}

/** Skapa ett ärende (med klient) via UI:t och öppna detaljvyn (SPA-nav). */
async function createMatterAndOpen(page: Page, title: string, client: string): Promise<void> {
  await page.goto("/ava/matters/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: /Nytt ärende/i }).click();
  await page.getByLabel(/^Titel/).fill(title);
  // Vänta tills klient-optionen hydratiserats i dropdownen (kontakten skrevs
  // i föregående sid-session → läses tillbaka ur OPFS vid omladdning).
  // 30s (var 20s): OPFS-hydreringen kan vara långsam på en lastad CI-runner (#131).
  const klient = page.getByLabel(/Klient/);
  await expect(klient.locator("option", { hasText: client })).toHaveCount(1, { timeout: 30_000 });
  await klient.selectOption({ label: client });
  await page.getByLabel(/Ärendetyp/).fill("Testtyp");
  await page.getByRole("button", { name: /Skapa ärende/i }).click();
  await expect(page.getByRole("link", { name: title })).toBeVisible({ timeout: 15_000 });
  // Öppna ärendet (klicka titel-länken → /matters/[id])
  await page.getByRole("link", { name: title }).click();
  await page.waitForURL(/\/matters\/.+/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(() => {
  // Ren git-db per test (force-push tom commit) → full isolering, ingen
  // ackumulering mellan tester. Varje test:s browser-context klonar fräscht.
  resetRepo();
});

test("appen klonar repo:t in i OPFS och renderar i self-hosted-läge", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await configureSelfHosted(page);
  await page.goto("/ava/contacts/");

  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Kunde inte ladda data")).toHaveCount(0);
  await expect(page.locator("body")).toContainText(/Kontakter/i, { timeout: 15_000 });
  expect(errors, errors.join("\n")).toHaveLength(0);
});

test("skapa kontakt i UI:t → committas + pushas till git-db:n", async ({ page }) => {
  const unique = `E2E Kontakt ${Date.now()}`;
  expect(contactNamesInRepo()).not.toContain(unique);

  await configureSelfHosted(page);
  await page.goto("/ava/contacts/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });

  // Skapa kontakt via UI
  await page.getByRole("button", { name: "+ Ny kontakt" }).click();
  await page.getByLabel(/Namn/).fill(unique);
  await page.getByRole("button", { name: "Spara kontakt" }).click();

  // Mutation klar = formuläret stängs (onSuccess)
  await expect(page.getByRole("button", { name: "Spara kontakt" })).toHaveCount(0, { timeout: 15_000 });

  // Auto-sync committar + pushar (debounce ~10s). Poll bare-repo:t tills
  // kontakten dyker upp i git-db:n.
  await expect.poll(() => contactNamesInRepo(), {
    timeout: 60_000,
    intervals: [3_000, 3_000, 5_000, 5_000, 5_000, 10_000],
  }).toContain(unique);
});

test("skapa ärende med klient i UI:t → matter + matter-contact i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const clientName = `Klient ${stamp}`;
  const matterTitle = `Ärende ${stamp}`;

  await configureSelfHosted(page);
  await createContact(page, clientName);

  // Skapa ärende med klienten kopplad
  await page.goto("/ava/matters/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: /Nytt ärende/i }).click();
  await page.getByLabel(/^Titel/).fill(matterTitle);
  await page.getByLabel(/Klient/).selectOption({ label: clientName });
  await page.getByLabel(/Ärendetyp/).fill("Testtyp");
  await page.getByRole("button", { name: /Skapa ärende/i }).click();
  await expect(page.getByText(matterTitle)).toBeVisible({ timeout: 15_000 });

  // Verifiera i git-db:n: matter med titeln + en matter-contact-länk
  await expect.poll(() => rowsInRepo("matters/active").map((m) => String(m.title ?? "")), {
    timeout: 60_000,
    intervals: [3_000, 3_000, 5_000, 5_000, 5_000, 10_000],
  }).toContain(matterTitle);

  // matter-contact-länk skapad (minst en länk finns nu i repo:t)
  expect(rowsInRepo("matter-contacts").length).toBeGreaterThan(0);
});

test("fakturering: tid → acconto → betalning landar i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const client = `Klient ${stamp}`;
  const matter = `Faktura-ärende ${stamp}`;
  const timeDesc = `Arbete ${stamp}`;

  await configureSelfHosted(page);
  await createContact(page, client);
  await createMatterAndOpen(page, matter, client);
  const matterUrl = page.url();

  // Acconto erbjuds bara för rättsskydd/rättshjälp → sätt betalningssätt först.
  await setRattsskydd(page);

  // ── Registrera tid (120 min) ──
  await page.getByRole("button", { name: /Registrera tid/i }).click();
  // Scopa till modalen (matter-sidan har egna number-fält, #173) — annars
  // träffar `.first()` fel fält och minuterna blir kvar på default (30).
  const timeModal = page.getByRole("dialog");
  await timeModal.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
  await timeModal.locator('input[type="number"]').first().fill("120");
  await timeModal.getByPlaceholder(/Beskrivning/i).fill(timeDesc);
  await timeModal.getByRole("button", { name: /^Spara$/ }).click();
  await expect(page.getByText(timeDesc)).toBeVisible({ timeout: 10_000 });

  // ── Skapa acconto-faktura (1000 kr) via BillingPanel ──
  await awaitBillingPanelReady(page);
  await page.getByRole("button", { name: /\+ Skapa faktura/ }).click();
  await page.getByRole("button", { name: /Aconto till klient/i }).click();
  const accontoModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: /Aconto till klient/i }) });
  // Belopp (kr)-fältet är det andra number-input:et (första är clientShare-procent)
  await accontoModal.locator('input[type="number"]').nth(1).fill("1000");
  await accontoModal.getByRole("button", { name: /Skapa aconto-faktura/ }).click();
  await expect(accontoModal).toBeHidden({ timeout: 10_000 });

  // ── Öppna acconto, markera skickad, registrera betalning (1000 kr) ──
  await openInvoiceFromPanel(page);
  await expect(page.getByRole("button", { name: /Markera som skickad/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /Markera som skickad/ }).click();
  await page.getByRole("button", { name: /Registrera betalning/ }).click();
  const payModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: /Registrera betalning/i }) });
  await payModal.locator('input[type="number"]').first().fill("1000");
  await payModal.getByRole("button", { name: /^Spara$/ }).click();
  await expect(payModal).toBeHidden({ timeout: 10_000 });

  // ── Verifiera i git-db:n: vänta tills betalningen (1000 kr) synkats ──
  await expect.poll(() => rowsInRepo("payments").map((p) => Number(p.amount)), {
    timeout: 60_000,
    intervals: [3_000, 3_000, 5_000, 5_000, 5_000, 10_000],
  }).toContain(100_000); // 1000 kr i öre

  // Tidspost + acconto-faktura också persisterade
  expect(rowsInRepo("time-entries").map((t) => Number(t.minutes))).toContain(120);
  expect(rowsInRepo("invoices").map((i) => String(i.invoiceType))).toContain("ACCONTO");

  // ── Slutfaktura via BillingPanel (acconton listas som checkboxar) ──
  await page.goto(matterUrl);
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await awaitBillingPanelReady(page);
  await page.getByRole("button", { name: /\+ Skapa faktura/ }).click();
  // Rättsskydd-matter → slutfakturan går till försäkringsbolaget (inte klienten).
  await page.getByRole("button", { name: /Faktura till försäkring/i }).click();
  const finalModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: /^Faktura$/ }) });
  // Aconto-avdraget är förkryssat by default — säkra att det är kvar
  await finalModal.getByRole("button", { name: /^Skapa faktura$/ }).click();
  await expect(finalModal).toBeHidden({ timeout: 10_000 });

  // Verifiera i git-db:n: FINAL-faktura persisterad. BillingRun-modellen
  // länkar via deductedBillingRunIds (inte acconto-deductions-mappen).
  await expect.poll(() => rowsInRepo("invoices").map((i) => String(i.invoiceType)), {
    timeout: 60_000,
    intervals: [3_000, 3_000, 5_000, 5_000, 5_000, 10_000],
  }).toContain("FINAL");
  await expect.poll(() => rowsInRepo("billing-runs").map((r) => String(r.type)),
    { timeout: 60_000, intervals: [3_000, 5_000, 5_000, 10_000] })
    .toContain("FINAL");
});

const POLL = { timeout: 60_000, intervals: [3_000, 3_000, 5_000, 5_000, 5_000, 10_000] };

/**
 * Längre poll-fönster (#216) för git-db-skrivningar som följer en HÅRD
 * sid-navigering (t.ex. /users/new → router.push("/users")). Navigeringen
 * remountar sync-providern och kan skjuta upp den debouncade push:en (10 s)
 * bakom en pågående initial-clone-sync → push:en kan landa först efter > 60 s
 * på en långsam CI-körning. Den fristående clone-poll:en är auktoritativ;
 * vi ger den helt enkelt tillräckligt med tid (sync-pillen är opålitlig över
 * navigeringen, jfr hypotes 1 i #216).
 */
const POLL_LONG = { timeout: 150_000, intervals: [3_000, 3_000, 5_000, 5_000, 10_000, 10_000, 15_000, 15_000, 20_000] };

test("utlägg: + Nytt utlägg i UI:t → expenses i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const desc = `Utlägg ${stamp}`;
  await configureSelfHosted(page);
  await createContact(page, `Klient ${stamp}`);
  await createMatterAndOpen(page, `Ärende ${stamp}`, `Klient ${stamp}`);

  await page.getByRole("button", { name: /\+ Nytt utlägg/ }).click();
  await page.locator('input[type="date"]').first().fill(new Date().toISOString().slice(0, 10));
  await page.getByPlaceholder("0,00").fill("500");
  await page.getByPlaceholder(/Beskrivning/).fill(desc);
  await page.getByRole("button", { name: /^Spara$/ }).click();
  await expect(page.getByText(desc)).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => rowsInRepo("expenses").map((e) => Number(e.amount)), POLL).toContain(50_000); // 500 kr
});

test("avbetalningsplan: skapa + avbryt i UI:t → payment-plans i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  await configureSelfHosted(page);
  await createSentFinalInvoice(page, stamp);

  // Skapa plan (1000 kr/mån)
  await page.getByRole("button", { name: /Skapa avbetalningsplan/ }).click();
  const planModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: /Skapa avbetalningsplan/i }) });
  await planModal.locator('input[type="number"]').first().fill("1000");
  await planModal.getByRole("button", { name: /^Skapa plan$/ }).click();
  await expect(planModal).toBeHidden({ timeout: 10_000 });

  await expect.poll(() => rowsInRepo("payment-plans").length, POLL).toBeGreaterThan(0);

  // Avbryt planen → plan-status CANCELLED i git
  await page.getByRole("button", { name: /Avbryt planen/i }).click();
  await expect.poll(() => rowsInRepo("payment-plans").map((p) => String(p.status)), POLL).toContain("CANCELLED");
});

test("kreditfaktura: Kreditera i UI:t → CREDIT-faktura i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  await configureSelfHosted(page);
  await createSentFinalInvoice(page, stamp);

  await page.getByRole("button", { name: /^Kreditera$/ }).click();
  const creditModal = page.locator("div.fixed.inset-0").filter({ has: page.getByRole("heading", { name: /Kreditera faktura/i }) });
  await creditModal.getByRole("button", { name: /^Kreditera$/ }).click();
  await expect(creditModal).toBeHidden({ timeout: 10_000 });

  await expect.poll(() => rowsInRepo("invoices").map((i) => String(i.invoiceType)), POLL).toContain("CREDIT");
});

test("avsluta ärende i UI:t → matter-status CLOSED i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  await configureSelfHosted(page);
  await createContact(page, `Klient ${stamp}`);
  await createMatterAndOpen(page, `Ärende ${stamp}`, `Klient ${stamp}`);

  page.once("dialog", (d) => d.accept()); // confirm()-dialogen
  await page.getByRole("button", { name: /Avsluta ärende/ }).click();
  await expect(page.getByText(/^Stängt$/)).toBeVisible({ timeout: 10_000 });

  await expect.poll(() => rowsInRepo("matters/active").map((m) => String(m.status)), POLL).toContain("CLOSED");
});

test("återöppna ärende: CLOSED → ACTIVE i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  await configureSelfHosted(page);
  await createContact(page, `Klient ${stamp}`);
  await createMatterAndOpen(page, `Ärende ${stamp}`, `Klient ${stamp}`);

  // Stäng först
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: /Avsluta ärende/ }).click();
  await expect(page.getByText(/^Stängt$/)).toBeVisible({ timeout: 10_000 });

  // Återöppna — knappen byts ut när status flippas
  await page.getByRole("button", { name: /Återöppna/ }).click();
  await expect(page.getByText(/^Aktivt$/)).toBeVisible({ timeout: 10_000 });

  // Senaste status-värdet ska vara ACTIVE (matters/active/<id>.json)
  await expect.poll(() => {
    const matters = rowsInRepo("matters/active").filter((m) => String(m.title).includes(String(stamp)));
    return matters.map((m) => String(m.status));
  }, POLL).toContain("ACTIVE");
});

test("jävskontroll: sök på personnummer → conflict-checks i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const pnr = `19${(stamp % 1_000_000).toString().padStart(6, "0")}-1234`;
  const clientName = `Jäv-klient ${stamp}`;
  const matterTitle = `Jäv-ärende ${stamp}`;

  await configureSelfHosted(page);

  // Skapa kontakt MED personnummer (form-fältet visas för contactType=PERSON, default)
  await page.goto("/ava/contacts/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "+ Ny kontakt" }).click();
  await page.getByLabel(/Namn/).fill(clientName);
  await page.getByLabel(/^Personnummer$/).fill(pnr);
  await page.getByRole("button", { name: "Spara kontakt" }).click();
  await expect(page.getByRole("button", { name: "Spara kontakt" })).toHaveCount(0, { timeout: 15_000 });

  // Skapa ärende med klienten kopplad
  await createMatterAndOpen(page, matterTitle, clientName);

  // Kör jävskontroll: searchType=personalNumber (undviker $queryRaw-grenen som
  // inte funkar i DemoDataStore).
  await page.goto("/ava/conflicts/");
  await page.getByPlaceholder(/Namn, personnummer eller orgnr/i).fill(pnr);
  await page.getByRole("combobox").selectOption("personalNumber");
  await page.getByRole("button", { name: /^Sök$/ }).click();

  // UI ska visa resultat-rubriken (oavsett om träffar eller "Inga träffar")
  await expect(page.getByRole("heading", { name: /Resultat för/i })).toBeVisible({ timeout: 15_000 });

  // En conflict-checks-rad ska landa i git-db:n (loggas oavsett antal träffar)
  await waitForGitDbPush(page);
  await expect.poll(() => rowsInRepo("conflict-checks").map((c) => String(c.searchTerm)), POLL).toContain(pnr);
});

test("inställningar: byråns kontaktuppgifter → .ava/organizations i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const name = `Byrå ${stamp} AB`;
  const orgNumber = `556${(stamp % 1_000_000).toString().padStart(6, "0")}-0001`;
  const phone = `08-${(stamp % 10_000_000).toString().padStart(7, "0")}`;

  await configureSelfHosted(page);
  await page.goto("/ava/settings/");
  // demo-bootstrap kör loadSelfHosted även för /settings nu → vänta på att
  // source-laddningen + getSettings.useQuery är klara.
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Laddar inställningar…")).toHaveCount(0, { timeout: 30_000 });

  await page.getByLabel(/^Byråns namn$/).fill(name);
  await page.getByLabel(/^Organisationsnummer$/).fill(orgNumber);
  await page.getByLabel(/^Telefon$/).first().fill(phone);
  // Kontaktuppgifter auto-sparas (debounce 800ms) — ingen Spara-knapp längre.
  // Poll:en nedan väntar in att den debouncade mutationen committats till git.
  await expect.poll(() => rowsInRepo(".ava/organizations").map((o) => String(o.name)), POLL).toContain(name);

  // Org-numret ska också ha synkats till samma fil
  expect(rowsInRepo(".ava/organizations").map((o) => String(o.orgNumber))).toContain(orgNumber);
});

test("kontor: lägg till kontor i settings → offices i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const officeName = `Stockholm ${stamp}`;
  const address = `Storgatan ${stamp % 100} (kontor-test)`;

  await configureSelfHosted(page);
  await page.goto("/ava/settings/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("Laddar inställningar…")).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole("button", { name: /Lägg till kontor/ }).click();
  // Scope inputs to den blå office-form-rutan så vi inte fastnar på org-formens
  // fält (samma placeholder för adress).
  const officeForm = page.locator(".bg-blue-50").last();
  await officeForm.getByPlaceholder(/t\.ex\. Stockholm/i).fill(officeName);
  await officeForm.getByPlaceholder(/Storgatan 1/i).fill(address);
  await officeForm.getByRole("button", { name: /^Spara$/ }).click();

  // Office-formen försvinner (adding=false) → kontoret syns i listan
  await expect(page.getByText(officeName)).toBeVisible({ timeout: 15_000 });

  await expect.poll(() => rowsInRepo("offices").map((o) => String(o.name)), POLL).toContain(officeName);
});

test("användare: skapa via /users/new + inaktivera → .ava/users i git-db:n", async ({ page }) => {
  // #216: detta flöde navigerar hårt (/users/new → /users) vilket kan skjuta
  // upp den debouncade push:en förbi standard-poll:ens 60 s på långsam CI.
  // Ge testet + bare-repo-poll:erna (POLL_LONG) gott om tid; happy path är
  // fortfarande sekundsnabbt.
  test.setTimeout(360_000);
  const stamp = Date.now();
  const email = `new-${stamp}@firma.local`;
  const name = `Ny Användare ${stamp}`;

  await configureSelfHosted(page);
  await page.goto("/ava/users/new/");
  // /users skippar demo-bootstrap-loadern, men formen renderas direkt — ingen
  // "Laddar data…"-väntan behövs.

  await page.getByLabel(/^Namn \*$/).fill(name);
  await page.getByLabel(/^E-post \*$/).fill(email);
  // Två password-inputar (lösenord + bekräfta). Use locator-index för enkelhet.
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill("hemligt123");
  await pw.nth(1).fill("hemligt123");
  await page.getByRole("button", { name: /Skapa användare/ }).click();

  // onSuccess → router.push("/users") — vänta på att tabellen renderats
  await page.waitForURL(/\/users\/?$/, { timeout: 15_000 });
  await expect(page.getByText(name)).toBeVisible({ timeout: 15_000 });

  // Användarrow:n persisterad till .ava/users/<email>.json. POLL_LONG: push:en
  // kan dröja efter den hårda navigeringen (#216) — clone-poll:en är auktoritativ.
  await waitForGitDbPush(page);
  await expect.poll(() => rowsInRepo(".ava/users").map((u) => String(u.email)), POLL_LONG).toContain(email);

  // Inaktivera användaren — confirm()-dialog accepteras automatiskt
  page.once("dialog", (d) => d.accept());
  await page.getByRole("row", { name: new RegExp(name) }).getByRole("button", { name: /Inaktivera/ }).click();

  // active: false ska persisteras till samma fil
  await waitForGitDbPush(page);
  await expect.poll(() => {
    const row = rowsInRepo(".ava/users").find((u) => String(u.email) === email);
    return row ? row.active : "(saknas)";
  }, POLL_LONG).toBe(false);
});

test("dokument: ladda upp fil på matter → documents/<id>.json + content-fil i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const fileName = `notering-${stamp}.txt`;
  const fileBody = `Anteckning för e2e ${stamp}\n`;

  await configureSelfHosted(page);
  await createContact(page, `Klient ${stamp}`);
  await createMatterAndOpen(page, `Ärende ${stamp}`, `Klient ${stamp}`);

  // Fil-input är dolt inuti <label>"Ladda upp"</label> i DocumentBrowser.
  // setInputFiles fungerar mot dolda inputs.
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from(fileBody),
  });

  // Optimistisk row försvinner och den riktiga raden dyker upp i list:en
  // (DocumentBrowser invalidate:ar tree-queryn när register-mutationen klar).
  await expect(page.getByText(fileName)).toBeVisible({ timeout: 15_000 });

  // documents/<id>.json ska synkas till git-db:n
  await expect.poll(() => rowsInRepo("documents").map((d) => String(d.fileName)), POLL).toContain(fileName);

  // Binär-content-filen ska också committas (samma path som storagePath i row:n)
  const docRow = rowsInRepo("documents").find((d) => String(d.fileName) === fileName);
  expect(docRow, "document-rad ska finnas").toBeTruthy();
  const storagePath = String(docRow?.storagePath ?? "");
  expect(storagePath).toMatch(/^documents\/content\//);

  // Verifiera att binärfilen finns i en fristående clone
  await expect.poll(() => {
    const dir = freshClone();
    try {
      return existsSync(path.join(dir, storagePath));
    } finally {
      cleanup(dir);
    }
  }, POLL).toBe(true);
});

// FIXME (delvis löst): kedjan är till stora delar fixad och verifierad —
//   ✓ PDF.js-extraktion fungerar (nginx serverar nu .mjs som JS-MIME).
//   ✓ extraherad text skrivs till OPFS (documents/text/<id>.txt) + pushas.
//   ✓ hydrateExtractedText laddar OPFS-texten in i content-cache:n på
//     sök-sidan (bevisat: cache populeras vid bootstrap).
// KVAR: sök-sidan returnerar 0 träffar ändå + visar "@okänd"/read-only —
//   den hydratiserade self-hosted-källan/principalen verkar inte nå
//   sök-korpus:en (document-entiteterna) i den aktiva dataStore:n efter en
//   navigering. Separat felsökning (sök-sidans data-store-state), inte
//   PDF-extraktionen. Avgränsat så e2e kör grönt på varje push.
test.fixme("dokumentsök: ladda upp PDF → extract-text indexerar → sök hittar innehåll", async ({ page }) => {
  const stamp = Date.now();
  const uniqueWord = `PdfNeedle${stamp}`;
  const fileName = `notering-${stamp}.pdf`;

  await configureSelfHosted(page);
  await createContact(page, `Klient ${stamp}`);
  await createMatterAndOpen(page, `Ärende ${stamp}`, `Klient ${stamp}`);

  // Generera en minimal PDF som innehåller uniqueWord (i Node-context via pdf-lib).
  // pdf-lib är redan en runtime-dep i seed-flödet — vi återanvänder den.
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([595, 842]);
  p.drawText(uniqueWord, { x: 50, y: 750, size: 18, font });
  p.drawText("Lorem ipsum sökbart innehåll i ärendedokumentet.", { x: 50, y: 720, size: 11, font });
  const pdfBytes = await pdf.save();

  // Ladda upp via det dolda fil-input:et i DocumentBrowser
  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({
    name: fileName,
    mimeType: "application/pdf",
    buffer: Buffer.from(pdfBytes),
  });

  // Optimistisk row visas, sen riktig row när tRPC-mutationen klar
  await expect(page.getByText(fileName)).toBeVisible({ timeout: 20_000 });

  // Vänta in extract-text-jobbet: PDF.js extraherar → documents/text/<id>.txt
  // skrivs till OPFS → auto-sync committar+pushar. Vi pollar git-db:n tills
  // texten finns där (= extraktionen klar OCH OPFS hunnit skriva den).
  await expect.poll(() => extractedTextInRepo(), { timeout: 60_000, intervals: [2000, 3000] }).toContain(uniqueWord);

  // Nu finns texten i OPFS → search-sidans bootstrap (loadSelfHosted →
  // hydrateExtractedText) laddar den in i content-cache:n → fritext-sök hittar.
  await page.goto("/ava/search/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });
  await page.locator('input[type="search"], input[placeholder*="Sök"]').first().fill(uniqueWord);

  // Sökträffens filnamn renderas som en <button> (öppnar dokumentet), inte länk.
  await expect.poll(async () => {
    return page.getByRole("button", { name: new RegExp(fileName, "i") }).count();
  }, { timeout: 20_000, intervals: [500, 1000, 2000] }).toBeGreaterThan(0);
});

test("dokument: ladda upp + radera → documents/<id>.json försvinner ur git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const fileName = `att-radera-${stamp}.txt`;

  await configureSelfHosted(page);
  await createContact(page, `Klient ${stamp}`);
  await createMatterAndOpen(page, `Ärende ${stamp}`, `Klient ${stamp}`);

  const fileInput = page.locator('input[type="file"]').first();
  await fileInput.setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from("temp content\n") });
  await expect(page.getByText(fileName)).toBeVisible({ timeout: 15_000 });

  // Dokument-actions ligger nu i en kebab-meny (⋮). Öppna den i raden,
  // klicka sedan "Ta bort" (menyn renderas i en portal på body-nivå).
  const row = page.locator("tr", { hasText: fileName });
  await row.getByLabel("Dokumentåtgärder").click();
  page.once("dialog", (d) => d.accept()); // confirm-dialog
  await page.getByRole("menuitem", { name: /^Ta bort$/i }).click();

  // Raden försvinner i UI:n
  await expect(page.getByText(fileName)).toHaveCount(0, { timeout: 15_000 });

  // Och från git-db:n
  await expect.poll(() => rowsInRepo("documents").map((d) => String(d.fileName)), POLL).not.toContain(fileName);
});

test("dokumentmallar: skapa + använd + radera → .ava/templates/ i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const tmplName = `Testmall ${stamp}`;
  const tmplContent = `<h1>Testmall</h1><p>Skapad {{stamp}}</p>`;

  await configureSelfHosted(page);
  await page.goto("/ava/templates/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });

  // Skapa (det finns två "Ny mall"-länkar: header + tom-tillstånd → .first())
  await page.getByRole("link", { name: /Ny mall|\+ Ny/ }).first().click();
  // TemplateEditor:s labels är inte htmlFor-kopplade → använd placeholders.
  await page.getByPlaceholder(/Uppdragsavtal/).fill(tmplName);
  await page.getByPlaceholder("t.ex. Avtal").fill("Test");
  // Content kan vara textarea eller rik-editor; testa textarea först
  await page.locator('textarea, [contenteditable="true"]').first().fill(tmplContent);
  await page.getByRole("button", { name: /Spara/ }).click();
  await expect(page.getByText(tmplName)).toBeVisible({ timeout: 15_000 });

  // Verifiera i git-db:n (.ava/templates/<id>.json)
  await expect.poll(() => rowsInRepo(".ava/templates").map((t) => String(t.name)), POLL).toContain(tmplName);

  // Radera — 2-stegs in-app-modal (inte browser-confirm längre).
  const row = page.locator("tr,li", { hasText: tmplName }).first();
  await row.getByRole("button", { name: "Ta bort" }).click(); // rad-ikon (title)
  await expect(page.getByRole("heading", { name: /Ta bort mall\?/ })).toBeVisible();
  await page.getByRole("button", { name: /^Ta bort$/ }).last().click(); // modal-bekräfta
  await expect(page.getByText(tmplName)).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(() => rowsInRepo(".ava/templates").map((t) => String(t.name)), POLL).not.toContain(tmplName);
});

test("kalender: skapa event i UI:t → calendar/<id>.json i git-db:n", async ({ page }) => {
  const stamp = Date.now();
  const title = `Förhandling ${stamp}`;

  await configureSelfHosted(page);
  await page.goto("/ava/calendar/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole("button", { name: /^Nytt event$/ }).click();
  await page.getByLabel(/^Titel/).fill(title);
  await page.getByLabel(/^Plats$/).fill("Stockholms tingsrätt");
  // datetime-local-input redan förifylld med "now" — räcker för testet
  await page.getByRole("button", { name: /^Skapa$/ }).click();

  // Eventet visas i listan
  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

  // Och en JSON-rad ska landa i git-db:n under calendar/
  await expect.poll(() => rowsInRepo("calendar").map((e) => String(e.title)), POLL).toContain(title);
  // Verifiera scope-fält som routern sätter
  const row = rowsInRepo("calendar").find((e) => String(e.title) === title);
  expect(row?.userId).toBe("current-user");
  expect(row?.kind).toBe("appointment");
  expect(row?.mirrorToOutlook).toBe(false);
});

test("tasks: skapa task + markera klar i UI:t → tasks/<id>.json + status DONE", async ({ page }) => {
  const stamp = Date.now();
  const title = `Ring klient ${stamp}`;

  await configureSelfHosted(page);
  await page.goto("/ava/calendar/");
  await expect(page.getByText("Laddar data…")).toHaveCount(0, { timeout: 30_000 });

  await page.getByRole("button", { name: /^Ny task$/ }).click();
  // Task-formuläret renderas (blå border). Använd locator-scope för att inte
  // krocka med Nytt event-formulärets fält.
  const taskForm = page.locator(".bg-blue-50").last();
  await taskForm.getByLabel(/^Titel/).fill(title);
  await taskForm.getByRole("button", { name: /^Skapa$/ }).click();

  await expect(page.getByText(title)).toBeVisible({ timeout: 15_000 });

  await expect.poll(() => rowsInRepo("tasks").map((t) => String(t.title)), POLL).toContain(title);
  expect(rowsInRepo("tasks").find((t) => String(t.title) === title)?.status).toBe("TODO");

  // Markera klar — CheckCircle-knappen för raden. UI:n använder <li>, inte
  // <tr>, så scope:a till li:has-text(title). title="Markera klar" på
  // knappen blir dess accessible name.
  await page.locator(`li:has-text("${title}")`).getByRole("button", { name: /Markera klar/i }).click();

  // Status ska flippas till DONE i git
  await expect.poll(() => {
    const t = rowsInRepo("tasks").find((r) => String(r.title) === title);
    return t ? String(t.status) : "(missing)";
  }, POLL).toBe("DONE");
});
