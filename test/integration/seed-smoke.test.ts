/**
 * Integrationstest: kör hela demo-seed:n genom DemoDataStore + appRouter
 * och anropar alla tRPC-procedurer som menyn:s sidor använder.
 *
 * Vi tar samma data som `yarn seed:local` genererar (`buildSeed()`) →
 * DemoSource → DemoDataStore → tRPC-caller. Allt som routrarna kraschar
 * på här, kraschar också i UI:n när användaren klickar runt.
 *
 * Designval: ETT test, många assertions. Vi vill snabbt veta exakt VILKEN
 * procedure som faller — och i vilken sidkontext.
 */

import { describe, it, expect } from "vitest";
import { buildSeed } from "../../tooling/scripts/seed-data";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { prebakeJoins } from "@/lib/client/demo/prebake-joins";
import { appRouter } from "@/lib/server/routers/_app";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";

const ORG_ID = "firma-ab";
const ADMIN_USER = { id: "current-user", email: "user@firma.local", name: "Anna Advokat", role: "ADMIN" as const, organizationId: ORG_ID };

function makeCaller(): ReturnType<typeof appRouter.createCaller> {
  const seed = buildSeed();
  const source: DemoSource = prebakeJoins({
    organizations: seed.organizations,
    offices: seed.offices,
    users: seed.users,
    contacts: seed.contacts,
    matters: seed.matters,
    matterContacts: seed.matterContacts,
    documents: seed.documents,
    timeEntries: seed.timeEntries,
    expenses: seed.expenses,
    invoices: seed.invoices,
    calendarEvents: seed.calendarEvents,
    tasks: seed.tasks,
    documentTemplates: seed.documentTemplates,
    conflictChecks: seed.conflictChecks,
    paymentPlans: seed.paymentPlans,
    paymentPlanReminders: seed.paymentPlanReminders,
    payments: seed.payments,
  } as DemoSource);

  // Self-hosted-läget i prod har ALLTID en writeBack (FSA → OPFS) — utan den
  // blir alla delegates read-only och routerns create-anrop (t.ex.
  // conflict.check som persisterar historik) kraschar. Här no-op:ar vi den
  // för att mimika produktions-uppsättningen.
  const dataStore = new DemoDataStore(source, async () => { /* no-op write-back */ });
  // Samma ports som Git-backenden wirar i prod (buildGitPorts) — så smoke-
  // testet speglar produktions-uppsättningen exakt.
  const ports = buildGitPorts(dataStore);
  return appRouter.createCaller({
    user: ADMIN_USER,
    dataStore,
    ports,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

describe("Seed-data smoke — varje meny-sida körs mot riktig DemoDataStore", () => {
  it("/ Dashboard — contacts.list + matter.list", async () => {
    const trpc = makeCaller();
    await expect(trpc.contacts.list({ page: 1, pageSize: 5 })).resolves.toBeDefined();
    await expect(trpc.matter.list({ page: 1, pageSize: 5, status: "ACTIVE" })).resolves.toBeDefined();
  });

  it("/calendar — calendar.list + task.list", async () => {
    const trpc = makeCaller();
    const events = await trpc.calendar.list();
    expect(Array.isArray(events)).toBe(true);
    const tasks = await trpc.task.list();
    expect(Array.isArray(tasks)).toBe(true);
  });

  it("/calendar multi-user — varje seedad användare har minst ett event", async () => {
    // För att multi-user-vyn ska kännas levande måste det finnas events
    // för flera användare. Annars känns "klicka i Björn" som en no-op.
    const trpc = makeCaller();
    const allUsers = ["current-user", "u-bjorn", "u-cecilia", "u-david", "u-eva"];
    const events = await trpc.calendar.listForUsers({ userIds: allUsers });
    const byUser = new Map<string, number>();
    for (const e of events) {
      const k = (e as { userId: string }).userId;
      byUser.set(k, (byUser.get(k) ?? 0) + 1);
    }
    for (const u of allUsers) {
      expect(byUser.get(u) ?? 0).toBeGreaterThan(0);
    }
  });

  it("/contacts — contacts.list + getById för varje seedad kontakt", async () => {
    const trpc = makeCaller();
    const list = await trpc.contacts.list({ page: 1, pageSize: 50 });
    expect(list.contacts.length).toBeGreaterThan(0);
    for (const c of list.contacts) {
      await expect(trpc.contacts.getById({ id: c.id })).resolves.toBeDefined();
    }
  });

  // Regression: Domstolsverkets brottmålstaxa-koncept. Vissa matters har
  // isTaxeArende=true; UI:n visar en "Taxa"-badge för dem. Skydda mot att
  // schema:t / seed:n tappar bort fältet.
  it("/matters — minst ETT taxeärende finns + flaggan är separat från paymentMethod", async () => {
    const trpc = makeCaller();
    const list = await trpc.matter.list({ page: 1, pageSize: 50 });
    const taxa = list.matters.filter((m: { isTaxeArende?: boolean }) => m.isTaxeArende === true);
    expect(taxa.length).toBeGreaterThan(0);
    // Och minst ETT brottmål med offentlig försvarare som INTE är taxa
    // (frångångstaxa-fall — bekräftar att flaggan är ortogonal mot paymentMethod)
    const nonTaxaOff = list.matters.filter((m: { paymentMethod?: string; isTaxeArende?: boolean }) =>
      m.paymentMethod === "OFFENTLIG_FORSVARARE" && m.isTaxeArende !== true,
    );
    expect(nonTaxaOff.length).toBeGreaterThan(0);
  });

  it("/matters — matter.list + getById för varje seedat ärende (utlöser docs/time/expense joins)", async () => {
    const trpc = makeCaller();
    const list = await trpc.matter.list({ page: 1, pageSize: 50 });
    expect(list.matters.length).toBeGreaterThan(0);
    for (const m of list.matters) {
      const detail = await trpc.matter.getById({ id: m.id });
      expect(detail.id).toBe(m.id);
      // Sidan listar även tidsposter + utlägg
      await trpc.timeEntry.list({ matterId: m.id });
      await trpc.expense.list({ matterId: m.id });
      // ...och dokument
      await trpc.document.tree({ matterId: m.id });
    }
  });

  it("/search — fritext-sök returnerar faktiska hits mot seed-datan + storagePath", async () => {
    const trpc = makeCaller();
    // "Stämningsansökan" är en av kinds i seed-datan → bör matcha minst 3 dokument
    const r = await trpc.document.search({ query: "stämning" });
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.totalHits).toBeGreaterThan(0);
    // Regression: hits MÅSTE inkludera storagePath så search-sidan kan öppna
    // filen via openDocument (annars 404 mot borttagna /api/-route:n).
    for (const hit of r.hits) {
      expect(hit.storagePath).toBeTruthy();
      expect(hit.storagePath).toMatch(/^documents\/content\//);
    }
  });

  it("/templates — documentTemplate.list + createdBy-join", async () => {
    const trpc = makeCaller();
    const list = await trpc.documentTemplate.list();
    expect(list.length).toBeGreaterThanOrEqual(5);
    // Sidan renderar `t.createdBy.name` — joinet får inte vara null/undefined
    // för seedade mallar (createdById="current-user" finns i users).
    for (const t of list) {
      expect(t.createdBy).toBeTruthy();
      expect((t as { createdBy: { name: string } }).createdBy.name).toBeTruthy();
    }
  });

  it("/time — timeEntry.list utan matter-filter", async () => {
    const trpc = makeCaller();
    const list = await trpc.timeEntry.list({});
    expect(list.entries.length).toBeGreaterThan(0);
    // Tabellen visar entry.user.name — joinet får inte vara null för seedad data
    for (const e of list.entries) expect(e.user).toBeDefined();
  });

  it("/conflicts — jävssök (conflict.check) + historik (conflict.history)", async () => {
    const trpc = makeCaller();
    await expect(trpc.conflict.check({ searchTerm: "Andersson", searchType: "name" })).resolves.toBeDefined();
    const history = await trpc.conflict.history({ page: 1, pageSize: 10 });
    expect(history.checks.length).toBeGreaterThan(0);
    // Sidan renderar `check.checkedBy.name` — joinet får inte vara null
    for (const c of history.checks) {
      expect((c as { checkedBy?: { name?: string } }).checkedBy?.name).toBeTruthy();
    }
  });

  it("/reports — reports.perLawyer för admin-användaren", async () => {
    const trpc = makeCaller();
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    // Sidan skickar from/to som "YYYY-MM-DD"-strängar från <input type="date">
    await expect(trpc.reports.perLawyer({
      userId: "current-user",
      from: start.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    })).resolves.toBeDefined();
  });

  // Regression: classify-document → updateMetadata → assertDocAccess
  // använder nested where `{matter: {organizationId}}`. Tidigare var
  // documents.matter-relationen "many" (default) → resolverades som
  // array → matchningen i query-engine:n failedde → NOT_FOUND tillbaka
  // till worker:n. UI:n visade "Försök igen".
  it("nested where via matter.organizationId hittar dokument (assertDocAccess)", async () => {
    const trpc = makeCaller();
    const matters = await trpc.matter.list({ page: 1, pageSize: 1, status: "ACTIVE" });
    const matterId = matters.matters[0].id;
    // Skapa ett färskt dokument via document.register-flödet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = (trpc.document as unknown as { register: any }).register;
    const doc = await reg({
      id: "doc-test-NOT_FOUND",
      matterId,
      fileName: "Polisen_sfi_ordlista.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1024,
      storagePath: "documents/content/doc-test-NOT_FOUND.pdf",
    });
    expect(doc.id).toBe("doc-test-NOT_FOUND");
    // Hit hände det förr: updateMetadata kastade NOT_FOUND eftersom
    // assertDocAccess inte kunde hitta doc via nested matter-org-filter.
    const updated = await trpc.document.updateMetadata({
      documentId: "doc-test-NOT_FOUND",
      documentType: "BEVIS",
      analyzedAt: new Date().toISOString(),
      analysisStatus: "DONE",
    });
    expect((updated as { documentType: string }).documentType).toBe("BEVIS");
  });

  it("/payment-plans — paymentPlan.list + getById för varje plan", async () => {
    const trpc = makeCaller();
    const list = await trpc.paymentPlan.list();
    expect(list.length).toBeGreaterThan(0);
    // Status-filter
    const active = await trpc.paymentPlan.list({ status: "ACTIVE" });
    for (const p of active) expect((p as { status: string }).status).toBe("ACTIVE");
    // Detalj-vyn ska inkludera invoice + matter + klient + reminders
    for (const p of list) {
      const detail = await trpc.paymentPlan.getById({ id: (p as { id: string }).id });
      expect((detail as { invoice: { matter: { matterNumber: string } } }).invoice.matter.matterNumber).toBeTruthy();
      expect(Array.isArray((detail as { reminders?: unknown[] }).reminders)).toBe(true);
    }
  });

  // INVARIANT: data-integritet mellan invoice.status och paymentPlan.status.
  // Skyddar mot orphans där en faktura är INSTALLMENT_PLAN men ingen plan
  // pekar tillbaka (UI:n skulle då visa olika antal i olika vyer).
  it("varje INSTALLMENT_PLAN-faktura har en motsvarande ACTIVE-plan", async () => {
    const trpc = makeCaller();
    const invoices = await trpc.invoice.list({ status: "INSTALLMENT_PLAN" });
    const activePlans = await trpc.paymentPlan.list({ status: "ACTIVE" });
    const planInvoiceIds = new Set(activePlans.map((p: { invoiceId: string }) => p.invoiceId));
    expect(invoices.length).toBeGreaterThan(0);
    for (const inv of invoices) {
      expect(planInvoiceIds.has(inv.id)).toBe(true);
    }
    // ...och varje ACTIVE-plan har en INSTALLMENT_PLAN-faktura (symmetri).
    const invoiceById = new Map(invoices.map((i: { id: string; status: string }) => [i.id, i.status]));
    for (const plan of activePlans) {
      expect(invoiceById.get(plan.invoiceId)).toBe("INSTALLMENT_PLAN");
    }
  });

  it("payments-rader finns för aktiva planer (avbetalningarna är seedade)", async () => {
    const trpc = makeCaller();
    const plans = await trpc.paymentPlan.list({ status: "ACTIVE" });
    let totalPayments = 0;
    for (const p of plans) {
      const detail = await trpc.paymentPlan.getById({ id: (p as { id: string }).id });
      const payments = ((detail as { invoice?: { payments?: unknown[] } }).invoice?.payments ?? []) as unknown[];
      totalPayments += payments.length;
    }
    expect(totalPayments).toBeGreaterThan(0);
  });

  it("/invoices — invoice.list + getById för varje faktura", async () => {
    const trpc = makeCaller();
    const list = await trpc.invoice.list({});
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    for (const inv of list) {
      await expect(trpc.invoice.getById({ id: inv.id })).resolves.toBeDefined();
    }
  });

  it("/users — user.list (admin) + user.getById", async () => {
    const trpc = makeCaller();
    const { users } = await trpc.user.list();
    expect(users.length).toBe(5);
    for (const u of users) {
      await expect(trpc.user.getById({ id: u.id })).resolves.toBeDefined();
    }
  });

  it("/profile — user.current", async () => {
    const trpc = makeCaller();
    const me = await trpc.user.current();
    expect(me.id).toBe("current-user");
    expect(me.role).toBe("ADMIN");
  });

  it("/settings — organization.getSettings", async () => {
    const trpc = makeCaller();
    await expect(trpc.organization.getSettings()).resolves.toBeDefined();
  });
});
