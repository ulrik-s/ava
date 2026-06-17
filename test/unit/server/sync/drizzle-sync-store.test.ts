/**
 * `DrizzleSyncStore` (#sync-bridge, ADR 0017) — server-auktoritativ delta-sync
 * + change_log-population. pglite/Postgres via createTestDb.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

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

  it("isolerar per org (pull ser inte en annan byrås ändringar)", async () => {
    expect((await sync.pull(uuidv7(), 0)).changes).toHaveLength(0);
  });

  it("push create är idempotent (åter-uppspelning ger accepted, dubbel-skapar ej)", async () => {
    const c1 = uuidv7();
    const row = { id: c1, organizationId: ORG, name: "Köad kontakt" };
    const first = await sync.push(ORG, mut("contact", "create", row));
    expect(first.status).toBe("accepted");
    const again = await sync.push(ORG, mut("contact", "create", row));
    expect(again.status).toBe("accepted");
    expect(await repos.contacts.getById(c1)).toMatchObject({ id: c1, name: "Köad kontakt" });
  });

  it("push update på surface-entitet med stale baseVersion → conflict", async () => {
    const inv = uuidv7();
    await repos.invoices.create({ id: inv, organizationId: ORG, matterId: uuidv7(), amount: 50000, invoiceDate: new Date(), status: "DRAFT" } as never);
    const res = await sync.push(ORG, mut("invoice", "update", { id: inv, status: "SENT" }, 99));
    expect(res.status).toBe("conflict");
    expect(res).toMatchObject({ reason: "stale" });
  });

  it("push delete → tombstone i pull (deleted: true)", async () => {
    const m2 = uuidv7();
    await repos.matters.create({ id: m2, organizationId: ORG, title: "Tas bort", status: "ACTIVE", matterNumber: "2026-0010" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;
    await sync.push(ORG, mut("matter", "delete", { id: m2 }));
    const change = (await sync.pull(ORG, cursor)).changes.find((c) => c.row.id === m2);
    expect(change).toMatchObject({ entity: "matter", deleted: true });
    expect(await repos.matters.getById(m2)).toBeNull();
  });
});
