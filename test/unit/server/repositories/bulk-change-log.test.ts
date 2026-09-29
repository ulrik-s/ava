/**
 * Bulkändringar i change_log (#1319).
 *
 * En faktureringskörning fryser poster med en enda `UPDATE … WHERE`. Förut
 * loggades ingenting och versionen höjdes inte, så andra enheter fick aldrig
 * veta att posterna var låsta. Samma sak gällde omflyttning av mappar och
 * dokument, förslag som besvaras i klump och huvudkontoret som byts.
 *
 * Nu gäller för varje bulkmetod: varje berörd rad får ny version och en
 * `update`-rad i change_log. Rader som inte berördes loggas inte.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { changeLog } from "@/lib/server/db/schema";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const USER = uuidv7();
const NOW = new Date("2026-09-30T08:00:00Z");

describe("bulkändringar loggas i change_log (#1319)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let matterId = "";

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Bulk", status: "ACTIVE", matterNumber: "2026-1319" } as never);
  });
  afterAll(async () => { await handle.close(); });

  /** De change_log-rader som gäller `ids`, som `entity:op`. */
  async function logged(ids: string[]): Promise<string[]> {
    const rows = await handle.db.select().from(changeLog);
    return rows.filter((r) => ids.includes(r.rowId)).map((r) => `${r.entity}:${r.op}`);
  }

  async function entry(extra: Record<string, unknown> = {}): Promise<string> {
    const id = uuidv7();
    await repos.timeEntries.create({ id, matterId, userId: USER, date: NOW, minutes: 30, description: "Samtal", hourlyRate: 1500, ...extra } as never);
    return id;
  }
  async function expense(extra: Record<string, unknown> = {}): Promise<string> {
    const id = uuidv7();
    await repos.expenses.create({ id, matterId, userId: USER, date: NOW, amount: 10_000, description: "Resa", billable: true, ...extra } as never);
    return id;
  }

  it("tidsposter: freezeForMatter fryser, höjer versionen och loggar varje post", async () => {
    const [a, b] = [await entry(), await entry()];
    const run = asId<"BillingRunId">(uuidv7());
    await repos.timeEntries.freezeForMatter(asId<"MatterId">(matterId), run, NOW);
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(a))).toMatchObject({ frozenByBillingRunId: run, version: 2 });
    expect(await logged([a, b])).toEqual(["timeEntry:create", "timeEntry:create", "timeEntry:update", "timeEntry:update"]);
  });

  it("tidsposter: freezeByIds loggar bara de valda, flagBilled loggar kopplingen till fakturan", async () => {
    const [picked, other] = [await entry(), await entry()];
    await repos.timeEntries.freezeByIds([asId<"TimeEntryId">(picked)], asId<"BillingRunId">(uuidv7()), NOW);
    await repos.timeEntries.flagBilled([asId<"TimeEntryId">(picked)], asId<"InvoiceId">(uuidv7()));
    expect(await logged([picked])).toEqual(["timeEntry:create", "timeEntry:update", "timeEntry:update"]);
    expect(await logged([other])).toEqual(["timeEntry:create"]);
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(picked))).toMatchObject({ version: 3 });
  });

  it("tidsposter: unfreezeByBillingRun låser upp och loggar; en fakturerad post behåller frysningen", async () => {
    const run = asId<"BillingRunId">(uuidv7());
    const free = await entry({ frozenAt: NOW, frozenByBillingRunId: run });
    const billed = await entry({ frozenAt: NOW, frozenByBillingRunId: run, invoiceId: uuidv7() });
    await repos.timeEntries.unfreezeByBillingRun(run);
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(free))).toMatchObject({ frozenAt: null, frozenByBillingRunId: null });
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(billed))).toMatchObject({ frozenByBillingRunId: null });
    expect(await logged([free])).toEqual(["timeEntry:create", "timeEntry:update"]);
    expect(await logged([billed])).toEqual(["timeEntry:create", "timeEntry:update"]);
  });

  it("utlägg: frysning, fakturering och upplåsning loggas", async () => {
    const [a, b] = [await expense(), await expense()];
    const run = asId<"BillingRunId">(uuidv7());
    await repos.expenses.freezeByIds([asId<"ExpenseId">(a)], run, NOW);
    await repos.expenses.freezeForMatter(asId<"MatterId">(matterId), asId<"BillingRunId">(uuidv7()), NOW);
    await repos.expenses.flagBilled([asId<"ExpenseId">(a)], asId<"InvoiceId">(uuidv7()));
    await repos.expenses.unfreezeByBillingRun(run);
    expect(await logged([a])).toEqual(["expense:create", "expense:update", "expense:update", "expense:update"]);
    expect(await logged([b])).toEqual(["expense:create", "expense:update"]);
  });

  it("en bulkmetod utan träffar loggar ingenting", async () => {
    const before = (await handle.db.select().from(changeLog)).length;
    await repos.timeEntries.unfreezeByBillingRun(asId<"BillingRunId">(uuidv7()));
    await repos.expenses.freezeByIds([], asId<"BillingRunId">(uuidv7()), NOW);
    expect((await handle.db.select().from(changeLog)).length).toBe(before);
  });

  it("mappar och dokument som flyttas när en mapp tas bort loggas", async () => {
    const from = uuidv7(); const child = uuidv7(); const doc = uuidv7();
    await repos.documentFolders.create({ id: from, matterId, name: "Gammal" } as never);
    await repos.documentFolders.create({ id: child, matterId, name: "Under", parentId: from } as never);
    await repos.documents.create({ id: doc, matterId, folderId: from, fileName: "a.pdf", mimeType: "application/pdf", storagePath: "x", sizeBytes: 1, uploadedById: USER } as never);
    await repos.documentFolders.reassignParent(asId<"DocumentFolderId">(from), null);
    await repos.documents.reassignFolder(asId<"DocumentFolderId">(from), null);
    expect(await logged([child])).toEqual(["documentFolder:create", "documentFolder:update"]);
    expect(await logged([doc])).toEqual(["document:create", "document:update"]);
  });

  it("kontaktförslag som besvaras i klump loggas", async () => {
    const doc = uuidv7(); const s = uuidv7();
    await repos.documents.create({ id: doc, matterId, fileName: "b.pdf", mimeType: "application/pdf", storagePath: "y", sizeBytes: 1, uploadedById: USER } as never);
    await repos.documentAnalysisSuggestions.create({ id: s, documentId: doc, name: "Anna", role: "MOTPART", contactType: "PERSON" } as never);
    await repos.documentAnalysisSuggestions.updateManyByIds([asId<"DocumentAnalysisSuggestionId">(s)], { status: "REJECTED" } as never);
    expect((await logged([s])).at(-1)).toMatch(/:update$/);
  });

  it("huvudkontoret som byts: det gamla loggas", async () => {
    const main = uuidv7();
    await repos.offices.create({ id: main, organizationId: ORG, name: "Stockholm", isMain: true } as never);
    await repos.offices.demoteMains(asId<"OrganizationId">(ORG));
    expect(await repos.offices.getById(asId<"OfficeId">(main))).toMatchObject({ isMain: false, version: 2 });
    expect(await logged([main])).toEqual(["office:create", "office:update"]);
  });
});
