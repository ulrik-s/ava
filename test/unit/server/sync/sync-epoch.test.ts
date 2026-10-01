/**
 * Synkens epok (#1360, migration 0041). pglite lokalt, riktig Postgres i CI:s
 * Postgres-jobb (`PG_TEST_URL`).
 *
 * Läses en backup in går change_log-sekvensen tillbaka, och nya ändringar får
 * nummer som klienterna redan passerat. Epoken är databasens synkhistorik:
 * `restore-db.sh` byter den, och en klient med en annan epok — eller en cursor
 * före den säkra gränsen — får en omsynk från 0 (`resync`).
 */

import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { syncEpoch } from "@/lib/server/db/schema";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { readPullHead } from "@/lib/server/sync/change-log-safe-seq";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

/** Satsen `restore-db.sh` kör efter att dumpen lästs in. */
const ROTATE = sql.raw(readFileSync("tooling/db/rotate-sync-epoch.sql", "utf8"));

describe("synkens epok (#1360)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let sync: DrizzleSyncStore;
  const org = uuidv7();

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    sync = new DrizzleSyncStore(handle.db, repos);
    await repos.contacts.create({ id: uuidv7(), organizationId: org, name: "Före backupen", contactType: "PERSON" } as never);
  });
  afterAll(async () => { await handle.close(); });

  it("migrationen skapar en epok-rad; pullen svarar med epoken", async () => {
    const [row] = await handle.db.select().from(syncEpoch);
    expect(row?.epoch).toMatch(/^[0-9a-f-]{36}$/);
    const res = await sync.pull(org, 0);
    expect(res.epoch).toBe(row?.epoch);
    expect(res.resync).toBeUndefined();
  });

  it("samma epok → vanlig delta, ingen omsynk", async () => {
    const first = await sync.pull(org, 0);
    const again = await sync.pull(org, first.cursor, first.epoch);
    expect(again).toEqual({ changes: [], cursor: first.cursor, hasMore: false, epoch: first.epoch });
  });

  it("en ny epok (återställd databas) → omsynk från 0 med den nya epoken", async () => {
    const before = await sync.pull(org, 0);
    await handle.db.execute(ROTATE);
    const after = await sync.pull(org, before.cursor, before.epoch);
    expect(after.resync).toBe(true);
    expect(after.epoch).not.toBe(before.epoch);
    expect(after.epoch).toBe((await readPullHead(handle.db)).epoch);
    // Hela historiken, inte bara det efter klientens gamla cursor.
    expect(after.changes).toHaveLength(before.changes.length);
    expect(after.cursor).toBe(before.cursor);
  });

  // #1388: med sidindelning gäller omsynken från första sidan; sidorna efter
  // den hämtas med den nya epoken och är vanliga sidor.
  it("omsynk över flera sidor: resync bara på första sidan, sedan vanliga sidor med den nya epoken", async () => {
    const pagedOrg = uuidv7();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = uuidv7();
      await repos.contacts.create({ id, organizationId: pagedOrg, name: `Kontakt ${i}`, contactType: "PERSON" } as never);
      ids.push(id);
    }
    const paged = new DrizzleSyncStore(handle.db, repos, undefined, 2);
    const before = await sync.pull(pagedOrg, 0);
    await handle.db.execute(ROTATE);

    const seen: unknown[] = [];
    let page = await paged.pull(pagedOrg, before.cursor, before.epoch);
    expect(page).toMatchObject({ resync: true, hasMore: true });
    const epoch = page.epoch;
    expect(epoch).not.toBe(before.epoch);
    seen.push(...page.changes.map((c) => c.row.id));
    while (page.hasMore) {
      expect(page.cursor).toBeLessThan(before.cursor);
      page = await paged.pull(pagedOrg, page.cursor, epoch);
      expect(page.resync).toBeUndefined();
      expect(page.epoch).toBe(epoch);
      seen.push(...page.changes.map((c) => c.row.id));
    }
    expect(seen).toEqual(ids);
    expect(page.cursor).toBe((await readPullHead(handle.db)).safe);
  });

  it("en cursor före gränsen med sidindelning: resync, sidan börjar från 0 och cursorn är sidans sista seq", async () => {
    const twoOrg = uuidv7();
    for (const name of ["Ett", "Två"]) await repos.contacts.create({ id: uuidv7(), organizationId: twoOrg, name, contactType: "PERSON" } as never);
    const head = await readPullHead(handle.db);
    const page = await new DrizzleSyncStore(handle.db, repos, undefined, 1).pull(twoOrg, head.safe + 1000, head.epoch ?? undefined);
    expect(page).toMatchObject({ resync: true, hasMore: true, changes: [{ entity: "contact" }] });
    expect(page.cursor).toBeLessThanOrEqual(head.safe);
  });

  it("en klient utan epok (äldre version) jämförs bara på cursorn", async () => {
    const head = await readPullHead(handle.db);
    expect((await sync.pull(org, head.safe)).resync).toBeUndefined();
    expect((await sync.pull(org, head.safe + 1)).resync).toBe(true);
  });

  it("saknas epok-raden skickas ingen epok och ingen jämförs — återställningen skapar en ny", async () => {
    await handle.db.delete(syncEpoch);
    const head = await readPullHead(handle.db);
    expect(head.epoch).toBeNull();
    const res = await sync.pull(org, head.safe, uuidv7());
    expect(res).toEqual({ changes: [], cursor: head.safe, hasMore: false });
    await handle.db.execute(ROTATE);
    expect((await readPullHead(handle.db)).epoch).toMatch(/^[0-9a-f-]{36}$/);
  });
});
