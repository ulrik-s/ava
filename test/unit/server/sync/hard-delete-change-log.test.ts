/**
 * Hård radering når `change_log` (#1234) — pglite.
 *
 * Routrar som raderar med `repo.hardDelete` (tidsposter, utlägg, kontakter,
 * uppgifter, kalender, mallar, kontor, dokument …) loggade ingenting när de
 * kördes direkt mot Postgres på servern (CLI/MCP, helper, och — med ADR 0037 —
 * serverns omkörning av köade procedurer). Då nådde raderingen aldrig andra
 * klienter: deras pull fick ingen tombstone och raden levde kvar lokalt.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { changeLog } from "@/lib/server/db/schema";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();

describe("hardDelete → change_log (#1234)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;
  let matterId: string;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    sync = new DrizzleSyncStore(handle.db, repos);
    matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Raderingar", status: "ACTIVE", matterNumber: "2026-1234" } as never);
  });
  afterAll(async () => { await handle.close(); });

  it("org-scopad rad (kontakt): pull ger en tombstone efter hård radering", async () => {
    const id = uuidv7();
    await repos.contacts.create({ id, organizationId: ORG, name: "Raderas på servern", contactType: "PERSON" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;

    await repos.contacts.hardDelete(asId<"ContactId">(id));

    const change = (await sync.pull(ORG, cursor)).changes.find((c) => c.row.id === id);
    expect(change).toEqual({ entity: "contact", row: { id }, deleted: true });
  });

  it("ärendescopad rad (tidspost, org via ärendet): tombstone", async () => {
    const id = uuidv7();
    await repos.timeEntries.create({
      id, matterId, userId: uuidv7(), date: new Date(), minutes: 30, description: "Samtal", hourlyRate: 1500,
    } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;

    await repos.timeEntries.hardDelete(asId<"TimeEntryId">(id));

    expect((await sync.pull(ORG, cursor)).changes.find((c) => c.row.id === id))
      .toMatchObject({ entity: "timeEntry", deleted: true });
  });

  it("change_log-raden är en delete med bumpad version", async () => {
    const id = uuidv7();
    await repos.contacts.create({ id, organizationId: ORG, name: "Versionskoll", contactType: "PERSON" } as never);
    await repos.contacts.hardDelete(asId<"ContactId">(id));
    const rows = (await handle.db.select().from(changeLog)).filter((r) => r.rowId === id);
    expect(rows.map((r) => [r.op, r.version])).toEqual([["create", 1], ["delete", 2]]);
  });

  it("dokument: delarna som kaskad-raderas i databasen får också tombstones", async () => {
    const doc = uuidv7(), part = uuidv7();
    await repos.documents.create({
      id: doc, matterId, fileName: "sammansatt.pdf", mimeType: "application/pdf",
      sizeBytes: 10, storagePath: "documents/content/z", uploadedById: uuidv7(),
    } as never);
    await repos.documentParts.create({
      id: part, documentId: doc, matterId, ordinal: 0, kind: "KALLELSE", fromPage: 1, toPage: 2, source: "AUTO",
    } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;

    await repos.documents.hardDelete(asId<"DocumentId">(doc));

    const changes = (await sync.pull(ORG, cursor)).changes;
    expect(changes.find((c) => c.row.id === doc)).toMatchObject({ entity: "document", deleted: true });
    expect(changes.find((c) => c.row.id === part)).toMatchObject({ entity: "documentPart", deleted: true });
  });

  it("inuti en transaktion: rollback tar med sig loggraden", async () => {
    const id = uuidv7();
    await repos.contacts.create({ id, organizationId: ORG, name: "Rullas tillbaka", contactType: "PERSON" } as never);
    const cursor = (await sync.pull(ORG, 0)).cursor;
    await expect(repos.transaction(async (tx) => {
      await tx.contacts.hardDelete(asId<"ContactId">(id));
      throw new Error("avbryt");
    })).rejects.toThrow("avbryt");
    expect(await repos.contacts.getById(asId<"ContactId">(id))).not.toBeNull();
    expect((await sync.pull(ORG, cursor)).changes.find((c) => c.row.id === id)).toBeUndefined();
  });

  it("id som inte finns → ingen loggrad, inget fel", async () => {
    const cursor = (await sync.pull(ORG, 0)).cursor;
    await repos.contacts.hardDelete(asId<"ContactId">(uuidv7()));
    expect((await sync.pull(ORG, cursor)).changes).toHaveLength(0);
  });

  it("utan påslagen loggning (klient/paritet) → ingen change_log", async () => {
    const plain = buildDrizzleRepositories(handle.db);
    const id = uuidv7();
    await plain.contacts.create({ id, organizationId: ORG, name: "Ologgad", contactType: "PERSON" } as never);
    await plain.contacts.hardDelete(asId<"ContactId">(id));
    const rows = (await handle.db.select().from(changeLog)).filter((r) => r.rowId === id);
    expect(rows).toHaveLength(0);
  });
});
