/**
 * Servern validerar synkade rader (#1242, del 1): byråavgränsning och låsta poster.
 *
 * Synk-push skrev raden som klienten skickade. `applyUpdate`/`applyDelete`
 * slog upp raden på id — utan att kontrollera byrån — och `applyCreate` tog
 * emot rader som pekade på en annan byrås ärende. En klient kunde alltså skriva
 * över eller radera en annan byrås rader genom att skicka deras id, och ändra
 * låsta (fakturerade/frysta) tidsposter och utlägg som routrarna vägrar röra.
 *
 * pglite/Postgres via createTestDb — samma repos och change_log som servern.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG_A = uuidv7();
const ORG_B = uuidv7();

function mut(entity: string, kind: QueuedMutation["kind"], row: Record<string, unknown>): QueuedMutation {
  return { mutationId: uuidv7(), entity, kind, row, enqueuedAt: 0 };
}

describe("synk-push: byråavgränsning och låsta poster (#1242)", () => {
  let handle: TestDbHandle;
  let repos: Repositories;
  let sync: DrizzleSyncStore;
  let matterA = "";
  let matterB = "";

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    sync = new DrizzleSyncStore(handle.db, repos);
    matterA = uuidv7(); matterB = uuidv7();
    await repos.matters.create({ id: matterA, organizationId: ORG_A, title: "A:s ärende", status: "ACTIVE", matterNumber: "2026-0001" } as never);
    await repos.matters.create({ id: matterB, organizationId: ORG_B, title: "B:s ärende", status: "ACTIVE", matterNumber: "2026-0001" } as never);
  });
  afterAll(async () => { await handle.close(); });

  describe("byråavgränsning", () => {
    it("update av en annan byrås rad → conflict, raden orörd och inget läcker", async () => {
      const res = await sync.push(ORG_A, mut("matter", "update", { id: matterB, organizationId: ORG_B, title: "Kapad" }));
      expect(res).toMatchObject({ status: "conflict", reason: "annan byrå" });
      expect(res).not.toHaveProperty("current");
      expect((await repos.matters.getById(asId<"MatterId">(matterB)))?.title).toBe("B:s ärende");
    });

    it("delete av en annan byrås rad → conflict, raden finns kvar", async () => {
      const res = await sync.push(ORG_A, mut("matter", "delete", { id: matterB }));
      expect(res).toMatchObject({ status: "conflict", reason: "annan byrå" });
      expect((await repos.matters.getById(asId<"MatterId">(matterB)))?.deletedAt ?? null).toBeNull();
    });

    it("update som flyttar en egen rad till en annan byrå → conflict", async () => {
      const own = uuidv7();
      await repos.contacts.create({ id: own, organizationId: ORG_A, name: "Egen kontakt" } as never);
      const res = await sync.push(ORG_A, mut("contact", "update", { id: own, organizationId: ORG_B, name: "Flyttad" }));
      expect(res).toMatchObject({ status: "conflict", reason: "annan byrå" });
      expect((await repos.contacts.getById(asId<"ContactId">(own)))?.organizationId).toBe(ORG_A);
    });

    it("create i en annan byrås ärende (tidspost via matterId) → conflict, skapas inte", async () => {
      const te = uuidv7();
      const res = await sync.push(ORG_A, mut("timeEntry", "create", { id: te, matterId: matterB, userId: uuidv7(), date: new Date(), minutes: 60, description: "In i B", billable: true, hourlyRate: 150_000 }));
      expect(res).toMatchObject({ status: "conflict", reason: "annan byrå" });
      expect(await repos.timeEntries.getById(asId<"TimeEntryId">(te))).toBeNull();
    });

    it("create med en annan byrås organizationId → conflict", async () => {
      const res = await sync.push(ORG_A, mut("contact", "create", { id: uuidv7(), organizationId: ORG_B, name: "Planterad" }));
      expect(res).toMatchObject({ status: "conflict", reason: "annan byrå" });
    });

    it("create vars byrå inte går att avgöra (ärendet finns inte) → conflict", async () => {
      const res = await sync.push(ORG_A, mut("timeEntry", "create", { id: uuidv7(), matterId: uuidv7(), userId: uuidv7(), date: new Date(), minutes: 30, description: "Föräldralös", billable: true, hourlyRate: 150_000 }));
      expect(res).toMatchObject({ status: "conflict", reason: "okänd byrå" });
    });

    it("egna rader går igenom: create i eget ärende och update av egen kontakt", async () => {
      const te = uuidv7();
      const created = await sync.push(ORG_A, mut("timeEntry", "create", { id: te, matterId: matterA, userId: uuidv7(), date: new Date(), minutes: 45, description: "Eget", billable: true, hourlyRate: 150_000 }));
      expect(created.status).toBe("accepted");
      const c = uuidv7();
      await repos.contacts.create({ id: c, organizationId: ORG_A, name: "Före" } as never);
      expect((await sync.push(ORG_A, mut("contact", "update", { id: c, organizationId: ORG_A, name: "Efter" }))).status).toBe("accepted");
    });

    it("förslag (via dokumentet) går igenom för egen byrå och stoppas för en annan", async () => {
      const doc = uuidv7();
      await repos.documents.create({ id: doc, matterId: matterA, fileName: "k.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: `documents/content/${doc}.pdf`, uploadedById: uuidv7() } as never);
      const sugg = uuidv7();
      await repos.documentAnalysisSuggestions.create({ id: sugg, documentId: doc, name: "Karin Holm", role: "VITTNE", contactType: "PERSON", status: "PENDING" } as never);
      expect((await sync.push(ORG_A, mut("documentAnalysisSuggestion", "update", { id: sugg, documentId: doc, status: "REJECTED" }))).status).toBe("accepted");
      expect(await sync.push(ORG_B, mut("documentAnalysisSuggestion", "update", { id: sugg, documentId: doc, status: "ACCEPTED" })))
        .toMatchObject({ status: "conflict", reason: "annan byrå" });
    });
  });

  describe("låsta tidsposter och utlägg", () => {
    async function lockedEntry(): Promise<string> {
      const id = uuidv7();
      await repos.timeEntries.create({ id, matterId: matterA, userId: uuidv7(), date: new Date("2026-06-01"), minutes: 60, description: "Fakturerad", billable: true, hourlyRate: 150_000, frozenAt: new Date("2026-06-30"), frozenByBillingRunId: uuidv7() } as never);
      return id;
    }

    it("ändrade minuter på en låst tidspost → conflict med serverns rad, posten orörd", async () => {
      const id = await lockedEntry();
      const current = await repos.timeEntries.getById(asId<"TimeEntryId">(id));
      const res = await sync.push(ORG_A, mut("timeEntry", "update", { ...current, minutes: 600 }));
      expect(res).toMatchObject({ status: "conflict", reason: "låst" });
      expect(res).toHaveProperty("current");
      expect((await repos.timeEntries.getById(asId<"TimeEntryId">(id)))?.minutes).toBe(60);
    });

    it("oförändrad rad (bara låsfälten ändras — körningen tas bort) går igenom", async () => {
      const id = await lockedEntry();
      const current = await repos.timeEntries.getById(asId<"TimeEntryId">(id));
      const res = await sync.push(ORG_A, mut("timeEntry", "update", { ...current, frozenAt: null, frozenByBillingRunId: null }));
      expect(res.status).toBe("accepted");
    });

    it("radera en låst tidspost → conflict, posten finns kvar", async () => {
      const id = await lockedEntry();
      expect(await sync.push(ORG_A, mut("timeEntry", "delete", { id }))).toMatchObject({ status: "conflict", reason: "låst" });
      expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).not.toBeNull();
    });

    it("ändrat belopp på ett fakturerat utlägg → conflict", async () => {
      const id = uuidv7();
      await repos.expenses.create({ id, matterId: matterA, userId: uuidv7(), date: new Date("2026-06-01"), amount: 38_000, description: "Resa", billable: true, invoiceId: uuidv7(), frozenAt: new Date("2026-06-30") } as never);
      const current = await repos.expenses.getById(asId<"ExpenseId">(id));
      expect(await sync.push(ORG_A, mut("expense", "update", { ...current, amount: 1 }))).toMatchObject({ status: "conflict", reason: "låst" });
    });

    it("en olåst tidspost går att ändra och radera som förut", async () => {
      const id = uuidv7();
      await repos.timeEntries.create({ id, matterId: matterA, userId: uuidv7(), date: new Date("2026-06-01"), minutes: 30, description: "Öppen", billable: true, hourlyRate: 150_000 } as never);
      const current = await repos.timeEntries.getById(asId<"TimeEntryId">(id));
      expect((await sync.push(ORG_A, mut("timeEntry", "update", { ...current, minutes: 45 }))).status).toBe("accepted");
      expect((await sync.push(ORG_A, mut("timeEntry", "delete", { id }))).status).toBe("accepted");
    });
  });
});
