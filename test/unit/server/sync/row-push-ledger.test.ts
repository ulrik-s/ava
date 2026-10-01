/**
 * En radpost avgörs en gång (#1414): samma `mutationId` — ett tappat svar,
 * eller samma kö från två flikar — får det sparade utfallet och tillämpas
 * aldrig igen. Utfallet sparas per byrå och post i `sync_replays`.
 *
 * pglite prövar omsändningen i följd; den äkta samtidigheten prövas mot
 * Postgres med en pool i CI:s "Repository (Postgres)"-jobb (`PG_TEST_URL`).
 */

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { changeLog, syncReplays } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleRepository } from "@/lib/server/repositories/drizzle-repository";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { ROW_GONE_REASON } from "@/lib/server/sync/row-push-decider";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createPooledTestDb, createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { pusher } from "./row-pusher";

const ORG = uuidv7();
const OTHER_ORG = uuidv7();

function mut(entity: string, kind: QueuedMutation["kind"], row: Record<string, unknown>, extra: Partial<QueuedMutation> = {}): QueuedMutation {
  return { mutationId: uuidv7(), entity, kind, row, enqueuedAt: 0, ...extra };
}

function setup(handle: TestDbHandle): { repos: DrizzleRepositories; sync: DrizzleSyncStore } {
  const repos = buildDrizzleRepositories(handle.db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
  return { repos, sync: new DrizzleSyncStore(handle.db, repos) };
}

async function changeLogOps(db: AppDb, rowId: string): Promise<string[]> {
  const rows = await db.select({ op: changeLog.op }).from(changeLog).where(eq(changeLog.rowId, rowId));
  return rows.map((r) => r.op);
}

async function storedOutcomes(db: AppDb, mutationId: string): Promise<Array<{ status: string; path: string; code: string | null }>> {
  return db.select({ status: syncReplays.status, path: syncReplays.path, code: syncReplays.code }).from(syncReplays)
    .where(and(eq(syncReplays.organizationId, asId<"OrganizationId">(ORG)), eq(syncReplays.mutationId, mutationId)));
}

describe("radpostens sparade utfall (#1414, pglite)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;

  beforeAll(async () => {
    handle = await createTestDb();
    ({ repos, sync } = setup(handle));
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await handle.close(); });

  async function contact(): Promise<string> {
    const id = uuidv7();
    await repos.contacts.create({ id, organizationId: ORG, name: "Före", contactType: "PERSON" } as never);
    return id;
  }

  it("samma ändring två gånger → tillämpas en gång, omsändningen får radens läge", async () => {
    const id = await contact();
    const m = mut("contact", "update", { id, organizationId: ORG, name: "Efter" });
    expect(await sync.push(pusher(ORG), m)).toMatchObject({ status: "accepted", row: { id, name: "Efter", version: 2 } });
    expect(await sync.push(pusher(ORG), m)).toMatchObject({ status: "accepted", row: { id, name: "Efter", version: 2 } });
    expect(await changeLogOps(handle.db, id)).toEqual(["create", "update"]);
    expect(await storedOutcomes(handle.db, m.mutationId)).toEqual([{ status: "accepted", path: "row:contact.update", code: null }]);
  });

  it("surface-entitet: omsändningen avvisas inte som inaktuell mot sin egen första tillämpning", async () => {
    const m3 = uuidv7(), doc = uuidv7(), sugg = uuidv7();
    await repos.matters.create({ id: m3, organizationId: ORG, title: "Förslag", status: "ACTIVE", matterNumber: `2026-${m3.slice(-4)}` } as never);
    await repos.documents.create({ id: doc, matterId: m3, fileName: "k.pdf", mimeType: "application/pdf", sizeBytes: 1, storagePath: `documents/content/${doc}`, uploadedById: uuidv7() } as never);
    await repos.documentAnalysisSuggestions.create({ id: sugg, documentId: doc, name: "Karin Holm", role: "VITTNE", contactType: "PERSON", status: "PENDING" } as never);
    const m = mut("documentAnalysisSuggestion", "update", { id: sugg, status: "REJECTED" }, { baseVersion: 1 });
    expect((await sync.push(pusher(ORG), m)).status).toBe("accepted");
    expect(await sync.push(pusher(ORG), m)).toMatchObject({ status: "accepted", row: { id: sugg, status: "REJECTED", version: 2 } });
  });

  it("en avvisad post får samma avvisning igen, utan att avgöras på nytt", async () => {
    const id = uuidv7();
    const m = mut("contact", "update", { id, organizationId: ORG, name: "Finns inte" });
    expect(await sync.push(pusher(ORG), m)).toEqual({ status: "conflict", reason: ROW_GONE_REASON });
    const read = vi.spyOn(DrizzleRepository.prototype, "getById");
    expect(await sync.push(pusher(ORG), m)).toEqual({ status: "conflict", reason: ROW_GONE_REASON });
    expect(read).not.toHaveBeenCalled();
    expect(await storedOutcomes(handle.db, m.mutationId)).toEqual([{ status: "rejected", path: "row:contact.update", code: "CONFLICT" }]);
  });

  it("raden har tagits bort sedan posten godtogs → omsändningen får en tombstone", async () => {
    const id = await contact();
    const m = mut("contact", "update", { id, organizationId: ORG, name: "Efter" });
    await sync.push(pusher(ORG), m);
    await sync.push(pusher(ORG), mut("contact", "delete", { id }));
    expect(await sync.push(pusher(ORG), m)).toEqual({ status: "accepted", row: { id }, deleted: true });
  });

  it("ett tekniskt fel sparar inget utfall — nästa försök tillämpar posten", async () => {
    const id = await contact();
    const m = mut("contact", "update", { id, organizationId: ORG, name: "Efter" });
    vi.spyOn(DrizzleRepository.prototype, "getById").mockRejectedValueOnce(new Error("nätet"));
    await expect(sync.push(pusher(ORG), m)).rejects.toThrow("nätet");
    expect(await storedOutcomes(handle.db, m.mutationId)).toEqual([]);
    expect(await sync.push(pusher(ORG), m)).toMatchObject({ status: "accepted", row: { name: "Efter", version: 2 } });
  });

  it("utfallet är byråns: samma mutationId från en annan byrå avgörs för sig", async () => {
    const id = await contact();
    const m = mut("contact", "update", { id, organizationId: ORG, name: "Efter" });
    await sync.push(pusher(ORG), m);
    expect(await sync.push(pusher(OTHER_ORG), m)).toEqual({ status: "conflict", reason: "annan byrå" });
  });

  it("en post med ett id som inte är ett uuid (äldre klient) sparas inte", async () => {
    const id = await contact();
    const m = mut("contact", "update", { id, organizationId: ORG, name: "Efter" }, { mutationId: "m-legacy" });
    await sync.push(pusher(ORG), m);
    expect(await sync.push(pusher(ORG), m)).toMatchObject({ status: "accepted", row: { version: 3 } });
  });
});

/** Riktig Postgres krävs för äkta samtidiga anslutningar; hoppas lokalt utan `PG_TEST_URL`. */
const itPg = process.env.PG_TEST_URL ? it : it.skip;

describe("samma radändring från flera flikar samtidigt mot riktig Postgres (#1414)", () => {
  const TABS = 4;
  let pooled: TestDbHandle | null = null;

  beforeAll(async () => { pooled = await createPooledTestDb(TABS); });
  afterAll(async () => { await pooled?.close(); });

  itPg("alla flikar får accepted, ändringen tillämpas en gång och ett utfall sparas", async () => {
    if (!pooled) throw new Error("PG_TEST_URL saknas");
    const { repos, sync } = setup(pooled);
    const id = uuidv7();
    await repos.contacts.create({ id, organizationId: ORG, name: "Före", contactType: "PERSON" } as never);
    const m = mut("contact", "update", { id, organizationId: ORG, name: "Efter" });

    const results = await Promise.all(Array.from({ length: TABS }, () => sync.push(pusher(ORG), m)));

    expect(results.map((r) => r.status)).toEqual(Array.from({ length: TABS }, () => "accepted"));
    expect(await repos.contacts.getById(asId<"ContactId">(id))).toMatchObject({ name: "Efter", version: 2 });
    expect(await changeLogOps(pooled.db, id)).toEqual(["create", "update"]);
    expect(await storedOutcomes(pooled.db, m.mutationId)).toHaveLength(1);
  });
});
