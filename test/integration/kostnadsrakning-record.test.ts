/**
 * Regressionstest: `kostnadsrakning.record` i demo-/git-backenden
 * ===============================================================
 *
 * Bug (juni 2026): användaren genererade en kostnadsräkning i ett brottmål,
 * UI:t visade grön "sparad i ärendets dokument"-banner — men inget dokument
 * dök upp i ärendet.
 *
 * Rotorsak: `kostnadsrakning.record` anropade `ctx.dataStore.events.emit(...)`
 * DIREKT (utan safeEmit). I demo/git-backenden är event-loggen read-only
 * (`ReadOnlyEventLog` → kastar `ReadOnlyError`). Eftersom mutationen INTE var
 * wrappad i en transaktion skapades dokumentet först (in-memory) och DÄREFTER
 * kastade emit:en — hela mutationen rejektade. Klientens `recordDocument`
 * svalde rejektet (console.warn) och hoppade över React-Query-invalideringen,
 * så DocumentBrowser:n fick aldrig en refetch → raden syntes aldrig.
 *
 * Detta test driver den ÄKTA tRPC-mutationen mot exakt samma store-konfig
 * som demo (`DemoDataStore` med writable delegates + read-only event-log) och
 * verifierar att (1) mutationen inte kastar och (2) dokumentet blir synligt
 * via `document.tree` + `document.list`. Före fixen: RÖTT (mutationen kastar).
 */

import { describe, it, expect, beforeAll } from "vitest-compat";
import { DemoDataStore, type DemoSource } from "@/lib/server/data-store/DemoDataStore";
import { prebakeJoins } from "@/lib/shared/demo-source";
import { appRouter } from "@/lib/server/routers/_app";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";

const ORG_ID = "firma-ab";
const ADMIN_USER = {
  id: "u-anna",
  email: "anna@firma.local",
  name: "Anna Advokat",
  role: "ADMIN" as const,
  organizationId: ORG_ID,
};

/** Bygg en store som EXAKT speglar demo: writable delegates (no-op write-back)
 *  + read-only event-log (ReadOnlyEventLog kastar på emit). */
function makeStore() {
  const source: DemoSource = prebakeJoins({
    organizations: [{ id: ORG_ID, name: "Anna Advokat AB", orgNumber: "556677-8899" }],
    users: [{ ...ADMIN_USER, hourlyRate: 250_000, title: "Senior partner" }],
    contacts: [], matters: [], matterContacts: [],
    documents: [], documentFolders: [], timeEntries: [], expenses: [],
    invoices: [], calendarEvents: [], tasks: [],
    documentTemplates: [], conflictChecks: [], offices: [],
    paymentPlans: [], paymentPlanReminders: [], payments: [],
  } as DemoSource);
  // Andra argumentet = onMutate (write-back). Satt → writable, precis som
  // demo-bootstrap.tsx gör. ReadOnlyEventLog används OAVSETT detta.
  const dataStore = new DemoDataStore(source, async () => { /* no-op write-back, som demo utan FSA */ });
  const ports = buildGitPorts(dataStore);
  const caller = appRouter.createCaller({
    user: ADMIN_USER, dataStore, ports,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return { caller, source };
}

describe("kostnadsrakning.record — dokumentet syns i ärendet (demo-backend)", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;
  let matterId: string;

  beforeAll(async () => {
    ({ caller } = makeStore());
    const klient = await caller.contacts.create({
      name: "Karl Karlsson",
      contactType: "PERSON",
      personalNumber: "19800615-1234",
    });
    const matter = await caller.matter.create({
      title: "Karl Karlsson — grovt narkotikabrott",
      matterType: "Brottmål",
      klientId: klient.id,
      isTaxeArende: true,
    });
    matterId = matter.id;
  });

  it("record() kastar INTE trots read-only event-log (safeEmit sväljer ReadOnlyError)", async () => {
    const docId = "kostn-test-1";
    // Före fixen rejektar detta med ReadOnlyError (emit kastar efter create).
    const doc = await caller.kostnadsrakning.record({
      id: docId,
      matterId,
      fileName: "Kostnadsräkning B 2026-1234.html",
      mimeType: "text/html; charset=utf-8",
      sizeBytes: 1234,
      storagePath: `documents/content/${docId}.html`,
      totalInclVat: 850_625,
      huvudforhandlingMinutes: 130,
    });
    expect((doc as { id: string }).id).toBe(docId);
    expect((doc as { documentType?: string }).documentType).toBe("Kostnadsräkning");
  });

  it("dokumentet är synligt via document.tree (det DocumentBrowser:n läser)", async () => {
    const tree = await caller.document.tree({ matterId });
    const found = tree.documents.find((d) => d.id === "kostn-test-1");
    expect(found).toBeDefined();
    expect(found!.fileName).toBe("Kostnadsräkning B 2026-1234.html");
    expect(found!.documentType).toBe("Kostnadsräkning");
  });

  it("dokumentet är synligt via document.list (det faktura-panelen läser)", async () => {
    const list = await caller.document.list({ matterId, folderId: null, pageSize: 100 });
    expect(list.documents.some((d) => d.id === "kostn-test-1")).toBe(true);
  });
});
