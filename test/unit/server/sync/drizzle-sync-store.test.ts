/**
 * `DrizzleSyncStore` (#sync-bridge, ADR 0017) — server-auktoritativ delta-sync
 * + change_log-population. pglite/Postgres via createTestDb.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { DrizzleSyncStore, MISSING_BASE_VERSION_REASON } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { pusher } from "./row-pusher";

const ORG = uuidv7();

function mut(entity: string, kind: QueuedMutation["kind"], row: Record<string, unknown>, baseVersion?: number): QueuedMutation {
  return {
    mutationId: uuidv7(),
    entity,
    kind,
    row,
    ...(baseVersion !== undefined ? { baseVersion } : {}),
    enqueuedAt: 0,
  };
}

describe("DrizzleSyncStore (#sync-bridge)", () => {
  let handle: TestDbHandle;
  let repos: Repositories;
  let sync: DrizzleSyncStore;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    sync = new DrizzleSyncStore(handle.db, repos);
  });
  afterAll(async () => { await handle.close(); });

  it("loggar skrivningar i change_log och pull:ar dem som kanoniska rader", async () => {
    const m1 = uuidv7();
    await repos.matters.create({ id: m1, organizationId: ORG, title: "Sync-ärende", status: "ACTIVE", matterNumber: "2026-0009" } as never);

    const res = await sync.pull(ORG, 0);
    expect(res.cursor).toBeGreaterThan(0);
    const change = res.changes.find((c) => c.row.id === m1);
    expect(change?.entity).toBe("matter");
    expect(change?.deleted).toBeFalsy();
    expect(change?.row).toMatchObject({ id: m1, title: "Sync-ärende" });

    // Cursor avancerad → ingen ny delta.
    expect((await sync.pull(ORG, res.cursor)).changes).toHaveLength(0);
  });

  // #653: org-raden saknar organizationId-kolumn (den ÄR org:en) → utan
  // resolveOrg-override (→ egna id:t) loggas den aldrig → synkas aldrig →
  // klientens organization.getSettings hittar inget → "Laddar inställningar…".
  it("organization delta-synkas via pull (org = sitt eget org-scope, #653)", async () => {
    const org2 = uuidv7();
    await repos.organizations.create({ id: org2, name: "Synk-byrå AB" } as never);
    const change = (await sync.pull(org2, 0)).changes.find((c) => c.row.id === org2);
    expect(change).toMatchObject({ entity: "organization", row: { id: org2, name: "Synk-byrå AB" } });
  });

  it("isolerar per org (pull ser inte en annan byrås ändringar)", async () => {
    expect((await sync.pull(uuidv7(), 0)).changes).toHaveLength(0);
  });

  it("push create är idempotent (åter-uppspelning ger accepted, dubbel-skapar ej)", async () => {
    const c1 = uuidv7();
    const row = { id: c1, organizationId: ORG, name: "Köad kontakt" };
    const first = await sync.push(pusher(ORG), mut("contact", "create", row));
    expect(first.status).toBe("accepted");
    const again = await sync.push(pusher(ORG), mut("contact", "create", row));
    expect(again.status).toBe("accepted");
    expect(await repos.contacts.getById(asId<"ContactId">(c1))).toMatchObject({ id: c1, name: "Köad kontakt" });
  });

  /** Ett dokumentförslag (en surface-entitet i radkön) i ett eget ärende. */
  async function suggestion(): Promise<string> {
    const m = uuidv7(), doc = uuidv7(), sugg = uuidv7();
    await repos.matters.create({ id: m, organizationId: ORG, title: "Förslag", status: "ACTIVE", matterNumber: `2026-${m.slice(-4)}` } as never);
    await repos.documents.create({ id: doc, matterId: m, fileName: "k.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: `documents/content/${doc}`, uploadedById: uuidv7() } as never);
    await repos.documentAnalysisSuggestions.create({ id: sugg, documentId: doc, name: "Karin Holm", role: "VITTNE", contactType: "PERSON", status: "PENDING" } as never);
    return sugg;
  }

  it("push update på surface-entitet med stale baseVersion → conflict", async () => {
    const sugg = await suggestion();
    const res = await sync.push(pusher(ORG), mut("documentAnalysisSuggestion", "update", { id: sugg, status: "REJECTED" }, 99));
    expect(res).toMatchObject({ status: "conflict", reason: "stale", current: { id: sugg, status: "PENDING" } });
  });

  // #1344: utan basversion kunde servern inte se om ändringen var inaktuell — den skrevs tyst över.
  it("push update på surface-entitet utan baseVersion → conflict, raden orörd", async () => {
    const sugg = await suggestion();
    const res = await sync.push(pusher(ORG), mut("documentAnalysisSuggestion", "update", { id: sugg, status: "REJECTED" }));
    expect(res).toMatchObject({ status: "conflict", reason: MISSING_BASE_VERSION_REASON, current: { id: sugg } });
    expect((await repos.documentAnalysisSuggestions.getById(asId<"DocumentAnalysisSuggestionId">(sugg)))?.status).toBe("PENDING");
  });

  it("push update på surface-entitet med aktuell baseVersion → accepted", async () => {
    const sugg = await suggestion();
    const res = await sync.push(pusher(ORG), mut("documentAnalysisSuggestion", "update", { id: sugg, status: "REJECTED" }, 1));
    expect(res).toMatchObject({ status: "accepted", row: { id: sugg, status: "REJECTED" } });
  });

  it("lww-entiteter behöver ingen baseVersion (kontakt)", async () => {
    const c = uuidv7();
    await repos.contacts.create({ id: c, organizationId: ORG, name: "Före" } as never);
    expect((await sync.push(pusher(ORG), mut("contact", "update", { id: c, organizationId: ORG, name: "Efter" }))).status).toBe("accepted");
  });

  it("push delete → tombstone i pull (deleted: true)", async () => {
    const c2 = uuidv7();
    await repos.contacts.create({ id: c2, organizationId: ORG, name: "Tas bort", contactType: "PERSON" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;
    await sync.push(pusher(ORG), mut("contact", "delete", { id: c2 }));
    const change = (await sync.pull(ORG, cursor)).changes.find((c) => c.row.id === c2);
    expect(change).toMatchObject({ entity: "contact", deleted: true });
    expect(await repos.contacts.getById(asId<"ContactId">(c2))).toBeNull();
  });

  // #528: document/documentFolder saknar org-kolumn → org härleds via ärendet
  // (resolveOrg-override) så de loggas i change_log och delta-synkas via pull.
  it("document + documentFolder delta-synkas via pull (org härledd ur ärendet, #528)", async () => {
    const m3 = uuidv7(), folder = uuidv7(), doc = uuidv7(), user = uuidv7();
    await repos.matters.create({ id: m3, organizationId: ORG, title: "Dok-synk", status: "ACTIVE", matterNumber: "2026-0011" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;

    await repos.documentFolders.create({ id: folder, matterId: m3, name: "Inlagor", parentId: null } as never);
    await repos.documents.create({
      id: doc, matterId: m3, fileName: "stamning.pdf", mimeType: "application/pdf",
      sizeBytes: 10, storagePath: "documents/content/x", uploadedById: user, folderId: folder,
    } as never);

    const changes = (await sync.pull(ORG, cursor)).changes;
    expect(changes.find((c) => c.row.id === folder)).toMatchObject({ entity: "documentFolder" });
    expect(changes.find((c) => c.row.id === doc)).toMatchObject({ entity: "document" });
  });

  // #1220: document_parts saknar org-kolumn → org via matter_id (samma fälla som #528).
  it("documentPart delta-synkas via pull, även tombstone vid ersättning (#1220)", async () => {
    const m = uuidv7(), doc = uuidv7(), user = uuidv7(), part = uuidv7();
    await repos.matters.create({ id: m, organizationId: ORG, title: "Del-synk", status: "ACTIVE", matterNumber: "2026-0020" } as never);
    await repos.documents.create({
      id: doc, matterId: m, fileName: "sammansatt.pdf", mimeType: "application/pdf",
      sizeBytes: 10, storagePath: "documents/content/y", uploadedById: user,
    } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;
    await repos.documentParts.create({
      id: part, documentId: doc, matterId: m, ordinal: 0, kind: "KALLELSE", fromPage: 1, toPage: 2, source: "AUTO",
    } as never);
    const created = (await sync.pull(ORG, cursor)).changes.find((c) => c.row.id === part);
    expect(created).toMatchObject({ entity: "documentPart", row: { kind: "KALLELSE", fromPage: 1, toPage: 2 } });
    const cursor2 = (await sync.pull(ORG, 0)).cursor;
    await repos.documentParts.softDelete(asId<"DocumentPartId">(part));
    expect((await sync.pull(ORG, cursor2)).changes.find((c) => c.row.id === part)).toMatchObject({ deleted: true });
    // Annan byrå ser inte delen.
    expect((await sync.pull(uuidv7(), 0)).changes.find((c) => c.row.id === part)).toBeUndefined();
  });

  // #632: matter_contacts/time_entries/expenses saknar org-kolumn (samma form som
  // document, #528) men missades — utan resolveOrg-override loggas de aldrig →
  // ärendet visar inga kontakter/tid/utlägg trots att raderna finns server-side.
  it("matterContact + timeEntry + expense delta-synkas via pull (org härledd ur ärendet, #632)", async () => {
    const m4 = uuidv7(), contact = uuidv7(), link = uuidv7(), te = uuidv7(), exp = uuidv7(), user = uuidv7();
    await repos.matters.create({ id: m4, organizationId: ORG, title: "Kontakt-synk", status: "ACTIVE", matterNumber: "2026-0012" } as never);
    await repos.contacts.create({ id: contact, organizationId: ORG, name: "Klient AB", contactType: "ORGANIZATION" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;

    await repos.matterContacts.create({ id: link, matterId: m4, contactId: contact, role: "KLIENT" } as never);
    await repos.timeEntries.create({
      id: te, matterId: m4, userId: user, date: new Date(), minutes: 60, description: "Möte", hourlyRate: 2000,
    } as never);
    await repos.expenses.create({
      id: exp, matterId: m4, userId: user, date: new Date(), description: "Ansökningsavgift", amount: 900, kind: "DISBURSEMENT",
    } as never);

    const changes = (await sync.pull(ORG, cursor)).changes;
    expect(changes.find((c) => c.row.id === link)).toMatchObject({ entity: "matterContact" });
    expect(changes.find((c) => c.row.id === te)).toMatchObject({ entity: "timeEntry" });
    expect(changes.find((c) => c.row.id === exp)).toMatchObject({ entity: "expense" });
  });

  // #647: faktura-entiteterna saknar org-kolumn → härled via ärendet (invoice/
  // billingRun) resp. fakturan→ärendet (payment/writeOff/paymentPlan), annars
  // syns ingen fakturering i klienten trots att raderna finns server-side.
  it("invoice + payment + paymentPlan delta-synkas via pull (org härledd ur fakturan/ärendet, #647)", async () => {
    const m5 = uuidv7(), inv = uuidv7(), pay = uuidv7(), plan = uuidv7(), wo = uuidv7(), user = uuidv7();
    await repos.matters.create({ id: m5, organizationId: ORG, title: "Faktura-synk", status: "ACTIVE", matterNumber: "2026-0013" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;

    await repos.invoices.create({ id: inv, matterId: m5, amount: 50000, invoiceDate: new Date(), status: "DRAFT" } as never);
    await repos.payments.create({ id: pay, invoiceId: inv, amount: 20000, paidAt: new Date(), recordedById: user } as never);
    await repos.paymentPlans.create({ id: plan, invoiceId: inv, monthlyAmount: 10000, dayOfMonth: 15, startDate: new Date(), status: "ACTIVE" } as never);
    await repos.writeOffs.create({ id: wo, invoiceId: inv, amount: 5000, writtenOffAt: new Date(), recordedById: user } as never);

    const changes = (await sync.pull(ORG, cursor)).changes;
    expect(changes.find((c) => c.row.id === inv)).toMatchObject({ entity: "invoice" });
    expect(changes.find((c) => c.row.id === pay)).toMatchObject({ entity: "payment" });
    expect(changes.find((c) => c.row.id === plan)).toMatchObject({ entity: "paymentPlan" });
    expect(changes.find((c) => c.row.id === wo)).toMatchObject({ entity: "writeOff" });
  });

  // #647: skrivningar INNE i en transaktion måste också loggas (tx-scopade repos
  // ärver change-log-recordern) — faktureringsflödena kör i tx.
  it("create inne i transaction loggas i change_log → delta-synkas (#647)", async () => {
    const m6 = uuidv7(), inv = uuidv7();
    await repos.matters.create({ id: m6, organizationId: ORG, title: "Tx-synk", status: "ACTIVE", matterNumber: "2026-0014" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;

    await repos.transaction(async (tx) => {
      await tx.invoices.create({ id: inv, matterId: m6, amount: 12345, invoiceDate: new Date(), status: "DRAFT" } as never);
    });

    const changes = (await sync.pull(ORG, cursor)).changes;
    expect(changes.find((c) => c.row.id === inv)).toMatchObject({ entity: "invoice" });
  });

  // #879: en köad mutation med ett icke-uuid rowId (lokalt genererat) får ALDRIG
  // kasta 22P02 och abortera reconcile-batchen. Men den får inte heller svaras
  // "accepted": då trodde klienten att raden sparats fast den bara fanns lokalt
  // (dataförlusten på ava-crm.io). "conflict" ackas också → ingen loop/hang.
  it("push med icke-uuid rowId → conflict, kastar ej, sparar inget (#879)", async () => {
    const res = await sync.push(pusher(ORG), mut("invoice", "create", {
      id: "mrg6gvmu-gbvt9s", matterId: uuidv7(), amount: 100, invoiceDate: new Date(), status: "DRAFT",
    }));
    expect(res.status).toBe("conflict");
    expect(res.status === "conflict" && res.reason).toMatch(/ogiltigt id/);
  });

  // #1280: klienten byter namn på ett dokument innan den hunnit pulla serverns
  // klassning. Radpushen bär de gamla metadata — klassningen ska stå kvar.
  it("en radpush med inaktuella metadata återställer inte serverns dokumentklassning (#1280)", async () => {
    const m = uuidv7(), doc = uuidv7(), user = uuidv7();
    await repos.matters.create({ id: m, organizationId: ORG, title: "Klassning", status: "ACTIVE", matterNumber: "2026-1280" } as never);
    const uploaded = {
      id: doc, matterId: m, fileName: "stamning.pdf", mimeType: "application/pdf",
      sizeBytes: 10, storagePath: "documents/content/y", uploadedById: user, documentType: null, analysisStatus: "PENDING", analyzedAt: null,
    };
    await repos.documents.create(uploaded as never);
    // Serverns jobb klassar dokumentet.
    await repos.documents.updateMetadata(asId<"DocumentId">(doc), { documentType: "STAMNING", analysisStatus: "DONE", analyzedAt: new Date("2026-09-01T10:00:00Z") } as never);

    const res = await sync.push(pusher(ORG), mut("document", "update", { ...uploaded, fileName: "stamning-tingsratten.pdf" }));
    expect(res.status).not.toBe("conflict");
    expect(await repos.documents.getById(asId<"DocumentId">(doc))).toMatchObject({
      fileName: "stamning-tingsratten.pdf", documentType: "STAMNING", analysisStatus: "DONE",
    });
  });

  // #1247: radkön följer samma köformat-regler som procedur-kön.
  it("radpush i för gammalt köformat → konflikt med besked; nyare än servern → kastar", async () => {
    const strict = new DrizzleSyncStore(handle.db, repos, { current: 2, min: 2, migrations: {} });
    const m = uuidv7();
    const old = { ...mut("matter", "create", { id: m, organizationId: ORG, title: "Gammal", status: "ACTIVE", matterNumber: "2026-1247" }), format: 1 };
    const res = await strict.push(pusher(ORG), old);
    expect(res).toMatchObject({ status: "conflict", reason: expect.stringMatching(/för gammal version av AVA/) });
    expect(await repos.matters.getById(asId<"MatterId">(m))).toBeNull();
    await expect(sync.push(pusher(ORG), { ...old, format: 99 })).rejects.toThrow(/Servern kör en äldre version/);
  });
});
