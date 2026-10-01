/**
 * Sidindelad, batchad delta-pull (#1388). pglite lokalt, riktig Postgres i
 * CI:s Postgres-jobb (`PG_TEST_URL`).
 *
 *   - Högst `pageLimit` change_log-rader per pull; fler → `hasMore`, och
 *     cursorn är sidans sista seq (aldrig förbi den säkra gränsen, #1381).
 *   - Raderna hämtas med EN fråga per entitet (`getByIds`), inte en per rad.
 *   - En raderad rad läses inte; en entitet som inte synkas → tombstone.
 */

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import type { PulledChange } from "@/lib/server/data-store/in-memory/sync-transport";
import { changeLog } from "@/lib/server/db/schema";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { readSafeSeq } from "@/lib/server/sync/change-log-safe-seq";
import { DrizzleSyncStore, PULL_PAGE_LIMIT } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

describe("DrizzleSyncStore.pull — sidindelad och batchad (#1388)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
  });
  afterAll(async () => { await handle.close(); });

  async function contacts(org: string, n: number): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const id = uuidv7();
      await repos.contacts.create({ id, organizationId: org, name: `Kontakt ${i}`, contactType: "PERSON" } as never);
      ids.push(id);
    }
    return ids;
  }

  async function seqs(org: string): Promise<number[]> {
    const rows = await handle.db.select({ seq: changeLog.seq }).from(changeLog)
      .where(eq(changeLog.organizationId, org)).orderBy(asc(changeLog.seq));
    return rows.map((r) => r.seq);
  }

  const ids = (changes: readonly PulledChange[]): unknown[] => changes.map((c) => c.row.id);

  it("standardgränsen är 500 loggrader per pull", () => {
    expect(PULL_PAGE_LIMIT).toBe(500);
  });

  it("delar pullen i sidor: hasMore, cursorn = sidans sista seq, nästa sida fortsätter där", async () => {
    const org = uuidv7();
    const created = await contacts(org, 5);
    const logged = await seqs(org);
    const sync = new DrizzleSyncStore(handle.db, repos, undefined, 2);

    const first = await sync.pull(org, 0);
    expect(ids(first.changes)).toEqual(created.slice(0, 2));
    expect(first).toMatchObject({ hasMore: true, cursor: logged[1] });

    const second = await sync.pull(org, first.cursor);
    expect(ids(second.changes)).toEqual(created.slice(2, 4));
    expect(second).toMatchObject({ hasMore: true, cursor: logged[3] });

    // Sista sidan: resten, och cursorn till den säkra gränsen (som innan).
    const last = await sync.pull(org, second.cursor);
    expect(ids(last.changes)).toEqual(created.slice(4));
    expect(last.hasMore).toBe(false);
    expect(last.cursor).toBe(await readSafeSeq(handle.db));
  });

  it("cursorn på en ofullständig sida ligger aldrig över den säkra gränsen", async () => {
    const org = uuidv7();
    await contacts(org, 3);
    const page = await new DrizzleSyncStore(handle.db, repos, undefined, 1).pull(org, 0);
    expect(page.hasMore).toBe(true);
    expect(page.cursor).toBeLessThanOrEqual(await readSafeSeq(handle.db));
    expect(page.cursor).toBe((await seqs(org))[0]);
  });

  it("exakt en full sida → inget hasMore, cursorn till gränsen", async () => {
    const org = uuidv7();
    await contacts(org, 2);
    const page = await new DrizzleSyncStore(handle.db, repos, undefined, 2).pull(org, 0);
    expect(page.changes).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(page.cursor).toBe(await readSafeSeq(handle.db));
  });

  it("samma rad ändrad flera gånger på en sida blir en ändring, med senaste läget", async () => {
    const org = uuidv7();
    const [id] = await contacts(org, 1);
    await repos.contacts.update(asId<"ContactId">(id ?? ""), { name: "Ändrad" });
    const page = await new DrizzleSyncStore(handle.db, repos).pull(org, 0);
    expect(page.changes).toHaveLength(1);
    expect(page.changes[0]?.row).toMatchObject({ id, name: "Ändrad" });
  });

  it("en fråga per entitet — aldrig en per rad — och en raderad rad läses inte", async () => {
    const org = uuidv7();
    const [keep1, keep2, gone] = await contacts(org, 3);
    const matter = uuidv7();
    await repos.matters.create({ id: matter, organizationId: org, title: "Batch", status: "ACTIVE", matterNumber: "2026-1388" } as never);
    await repos.contacts.softDelete(asId<"ContactId">(gone ?? ""));

    const counted = buildDrizzleRepositories(handle.db);
    const calls: Array<{ entity: string; ids: readonly string[] }> = [];
    const count = (entity: string, repo: { getByIds: (ids: readonly never[]) => Promise<unknown[]>; getById: unknown }): void => {
      const real = repo.getByIds.bind(repo);
      repo.getByIds = (batch) => { calls.push({ entity, ids: batch }); return real(batch); };
      repo.getById = () => { throw new Error("pullen får inte läsa rad för rad"); };
    };
    count("contact", counted.contacts);
    count("matter", counted.matters);

    const page = await new DrizzleSyncStore(handle.db, counted).pull(org, 0);
    expect(calls).toEqual([{ entity: "contact", ids: [keep1, keep2] }, { entity: "matter", ids: [matter] }]);
    expect(page.changes.find((c) => c.row.id === gone)).toEqual({ entity: "contact", row: { id: gone }, deleted: true });
    expect(page.changes.find((c) => c.row.id === matter)).toMatchObject({ entity: "matter", row: { title: "Batch" } });
  });

  it("en entitet som inte synkas blir en tombstone", async () => {
    const org = uuidv7(), rowId = uuidv7();
    await createDbChangeLogRecorder(handle.db).record({ organizationId: org, entity: "okänd", rowId, version: 1, op: "update" });
    const page = await new DrizzleSyncStore(handle.db, repos).pull(org, 0);
    expect(page.changes).toEqual([{ entity: "okänd", row: { id: rowId }, deleted: true }]);
  });
});
