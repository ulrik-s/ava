/**
 * Samma radpost från flera flikar samtidigt (#1380). Alla läser "ingen rad",
 * en skapar den, resten får unikhetsfel (23505) — som ska bli samma svar som
 * en omsändning i följd (accepted), eller en konflikt, aldrig ett 500.
 *
 * pglite-delen tvingar fram kapplöpningen deterministiskt (en inaktuell första
 * läsning, riktigt unikhetsfel från databasen). Den riktiga samtidigheten prövas
 * mot Postgres med en pool i CI:s "Repository (Postgres)"-jobb (`PG_TEST_URL`).
 */

import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { changeLog } from "@/lib/server/db/schema";
import type { AppDb } from "@/lib/server/db/types";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleRepository } from "@/lib/server/repositories/drizzle-repository";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { DUPLICATE_ROW_REASON, ID_TAKEN_REASON, ROW_GONE_REASON } from "@/lib/server/sync/row-push-decider";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createPooledTestDb, createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { pusher } from "./row-pusher";

const ORG = uuidv7();

function mut(kind: QueuedMutation["kind"], row: Record<string, unknown>, mutationId: string = uuidv7()): QueuedMutation {
  return { mutationId, entity: "contact", kind, row, enqueuedAt: 0 };
}

function contactRow(id: string, createdAt = "2026-10-01T08:00:00.000Z"): Record<string, unknown> {
  // Klientens rad når servern med Date (superjson).
  return { id, organizationId: ORG, name: "Flikkontakt", createdAt: new Date(createdAt) };
}

async function changeLogOps(db: AppDb, rowId: string): Promise<string[]> {
  const rows = await db.select({ op: changeLog.op }).from(changeLog)
    .where(and(eq(changeLog.organizationId, ORG), eq(changeLog.rowId, rowId)));
  return rows.map((r) => r.op);
}

function setup(handle: TestDbHandle): { repos: DrizzleRepositories; sync: DrizzleSyncStore } {
  const repos = buildDrizzleRepositories(handle.db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
  return { repos, sync: new DrizzleSyncStore(handle.db, repos) };
}

describe("radpush vid kapplöpning (#1380, pglite)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;

  beforeAll(async () => {
    handle = await createTestDb();
    ({ repos, sync } = setup(handle));
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await handle.close(); });

  /**
   * Nästa läsning ser ingen rad — som en flik som läste innan den andra hann
   * skapa. Pushen läser genom transaktionens repon, så det är basklassens
   * `getById` som byts ut.
   */
  function staleFirstRead(): ReturnType<typeof vi.spyOn> {
    return vi.spyOn(DrizzleRepository.prototype, "getById").mockResolvedValueOnce(null);
  }

  it("en samtidig push av samma rad hann skapa den → accepted med raden, en rad och en create i change_log", async () => {
    const id = uuidv7();
    expect((await sync.push(pusher(ORG), mut("create", contactRow(id)))).status).toBe("accepted");

    // En annan köpost (annat mutationId) med samma skapande — t.ex. en äldre
    // klient som köade om raden — läste innan raden fanns.
    staleFirstRead();
    const raced = await sync.push(pusher(ORG), mut("create", contactRow(id)));
    expect(raced).toMatchObject({ status: "accepted", row: { id, name: "Flikkontakt" } });
    expect(await changeLogOps(handle.db, id)).toEqual(["create"]);
  });

  it("en annan rad med samma id hann före → konflikt med serverns rad, inget skrivs över", async () => {
    const id = uuidv7();
    await sync.push(pusher(ORG), mut("create", contactRow(id)));

    staleFirstRead();
    const other = await sync.push(pusher(ORG), mut("create", { ...contactRow(id, "2026-10-01T09:00:00.000Z"), name: "Annan" }));
    expect(other).toMatchObject({ status: "conflict", reason: ID_TAKEN_REASON, current: { id, name: "Flikkontakt" } });
    expect(await repos.contacts.getById(asId<"ContactId">(id))).toMatchObject({ name: "Flikkontakt" });
  });

  it("i följd: samma skapande → accepted, ett annat skapande med samma id → konflikt", async () => {
    const id = uuidv7();
    await sync.push(pusher(ORG), mut("create", contactRow(id)));
    expect((await sync.push(pusher(ORG), mut("create", contactRow(id)))).status).toBe("accepted");
    expect(await sync.push(pusher(ORG), mut("create", contactRow(id, "2026-10-02T08:00:00.000Z"))))
      .toMatchObject({ status: "conflict", reason: ID_TAKEN_REASON });
  });

  it("en ändring av en rad som tagits bort → konflikt utan serverns rad, ingen ny rad och inget i change_log (#1399)", async () => {
    const id = uuidv7();
    await sync.push(pusher(ORG), mut("create", contactRow(id)));
    await sync.push(pusher(ORG), mut("delete", { id }));
    const createSpy = vi.spyOn(repos.contacts, "create");

    expect(await sync.push(pusher(ORG), mut("update", { ...contactRow(id), name: "Ändrad" })))
      .toEqual({ status: "conflict", reason: ROW_GONE_REASON });
    expect(createSpy).not.toHaveBeenCalled();
    expect(await repos.contacts.getById(asId<"ContactId">(id))).toBeNull();
    expect(await changeLogOps(handle.db, id)).toEqual(["create", "delete"]);
  });

  it("en ändring av ett id som aldrig funnits → samma konflikt, raden skapas inte (#1399)", async () => {
    const id = uuidv7();
    expect(await sync.push(pusher(ORG), mut("update", contactRow(id))))
      .toEqual({ status: "conflict", reason: ROW_GONE_REASON });
    expect(await changeLogOps(handle.db, id)).toEqual([]);
  });

  it("ett annat data-/integritetsfel från databasen → konflikt med felet, inte 500 (#1399)", async () => {
    const id = uuidv7();
    const res = await sync.push(pusher(ORG), mut("create", { ...contactRow(id), name: null }));
    expect(res).toMatchObject({ status: "conflict" });
    expect(res.status === "conflict" ? res.reason : "").toStartWith("Ändringen gick inte att spara: ");
  });

  it("skapa ett id som tagits bort (raden finns kvar som tombstone) → konflikt, inte 500", async () => {
    const id = uuidv7();
    await sync.push(pusher(ORG), mut("create", contactRow(id)));
    await sync.push(pusher(ORG), mut("delete", { id }));

    expect(await sync.push(pusher(ORG), mut("create", contactRow(id))))
      .toEqual({ status: "conflict", reason: DUPLICATE_ROW_REASON });
  });

  it("andra fel kastas vidare (tekniskt fel → klienten försöker igen), även i det andra försöket", async () => {
    const id = uuidv7();
    vi.spyOn(DrizzleRepository.prototype, "getById").mockRejectedValueOnce(new Error("nätet"));
    await expect(sync.push(pusher(ORG), mut("create", contactRow(id)))).rejects.toThrow("nätet");

    await sync.push(pusher(ORG), mut("create", contactRow(id)));
    vi.spyOn(DrizzleRepository.prototype, "getById")
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error("nätet igen"));
    await expect(sync.push(pusher(ORG), mut("create", contactRow(id)))).rejects.toThrow("nätet igen");
  });
});

/** Riktig Postgres krävs för äkta samtidiga anslutningar; hoppas lokalt utan `PG_TEST_URL`. */
const itPg = process.env.PG_TEST_URL ? it : it.skip;

describe("radpush från flera flikar samtidigt mot riktig Postgres (#1380)", () => {
  const TABS = 4;
  let pooled: TestDbHandle | null = null;

  beforeAll(async () => { pooled = await createPooledTestDb(TABS); });
  afterAll(async () => { await pooled?.close(); });

  itPg("samma köpost från alla flikar → alla accepted, en rad och en create per kontakt", async () => {
    if (!pooled) throw new Error("PG_TEST_URL saknas");
    const { repos, sync } = setup(pooled);
    const posts = Array.from({ length: 5 }, () => mut("create", contactRow(uuidv7())));

    const results = await Promise.all(posts.flatMap((m) =>
      Array.from({ length: TABS }, () => sync.push(pusher(ORG), m))));

    expect(results.map((r) => r.status)).toEqual(Array.from({ length: posts.length * TABS }, () => "accepted"));
    for (const m of posts) {
      const id = String(m.row.id);
      expect(await repos.contacts.getById(asId<"ContactId">(id))).toMatchObject({ id, name: "Flikkontakt" });
      expect(await changeLogOps(pooled.db, id)).toEqual(["create"]);
    }
  });
});
