/**
 * `createServerFirstStore` och delta-cursorn (#1711, ADR 0017 §1).
 *
 * Self-hosted-klienten sparar cursorn och serverns synkepok i snapshotets
 * databas, i samma transaktion som snapshotet. Det som skyddas:
 *   - en omladdad flik fortsätter från den sparade cursorn, med den sparade epoken,
 *   - cursorn ligger i användarens namnrymd och delas aldrig mellan användare,
 *   - cursorn är aldrig före snapshotet — inte heller när två flikar delar
 *     lagringen och fliken som saknar de senaste raderna skriver sist,
 *   - utan snapshot börjar synken från 0,
 *   - bindningsfasen sparar ingenting,
 *   - efter en återställd databas ger första reconcilen i en omladdad flik
 *     `resync` och `prune`.
 *
 * Servern är en fejk som talar tRPC-batchprotokollet för `sync.pull` och
 * `sync.push` — inget annat anropas i testerna.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import { z } from "zod";
import { dbNameIn, LOCAL_DB, localScopeSchema, userNamespace, type LocalScope } from "@/lib/client/backend/local-data/local-namespace";
import { InMemoryRejectedChangesPersistence, RejectedChanges } from "@/lib/client/backend/rejected-changes";
import { createServerFirstStore, type ServerFirstStoreDeps } from "@/lib/client/backend/server-first-store";
import type { CachingSyncDataStore } from "@/lib/client/local-store/caching-sync-data-store";
import { IdbKv } from "@/lib/client/local-store/idb-kv";
import type { PulledChange, PullResult } from "@/lib/server/data-store/in-memory/sync-transport";
import { parseJsonWith } from "@/lib/shared/parse-json";

const anna = localScopeSchema.parse({ organizationId: "org-1", principalId: "u-anna" });
const bea = localScopeSchema.parse({ organizationId: "org-1", principalId: "u-bea" });
const EPOCH = "01a0f754-b809-7662-8de5-646987f19b9e";
const RESTORED = "01a0f754-b809-7662-8de5-646987f19b9f";
const ROW_1 = "0199a0cf-d42b-7c09-a5cc-535a9dc76aa1";
const ROW_2 = "0199a0cf-d42b-7c09-a5cc-535a9dc76aa2";
const LOCAL = "0199a0cf-d42b-7c09-a5cc-535a9dc76aa9";

const contact = (id: string): Record<string, unknown> => ({ id, organizationId: "org-1", name: `Kontakt ${id.slice(-1)}`, contactType: "PERSON", version: 1 });

const pullInput = z.object({ "0": z.object({ json: z.object({ sinceCursor: z.number(), epoch: z.string().optional() }) }) });
const pushInput = z.object({ "0": z.object({ json: z.object({ entity: z.string(), row: z.record(z.string(), z.unknown()) }) }) });

const reply = (json: unknown): Response =>
  new Response(JSON.stringify([{ result: { data: { json } } }]), { headers: { "content-type": "application/json" } });

/** En server med en ändringslogg och en synkepok (#1360). */
class FakeSyncServer {
  epoch = EPOCH;
  pulls: Array<{ sinceCursor: number; epoch?: string | undefined }> = [];
  private log: PulledChange[] = [];

  add(...rows: Array<Record<string, unknown>>): void {
    for (const row of rows) this.log.push({ entity: "contact", row });
  }

  /** Databasen läses in ur en backup: ny epok, bara backupens rader. */
  restoreFromBackup(...rows: Array<Record<string, unknown>>): void {
    this.epoch = RESTORED;
    this.log = [];
    this.add(...rows);
  }

  private pull(query: z.infer<typeof pullInput>["0"]["json"]): PullResult {
    this.pulls.push(query);
    const resync = query.epoch !== undefined && query.epoch !== this.epoch;
    const changes = this.log.slice(resync ? 0 : query.sinceCursor);
    return { changes, cursor: this.log.length, epoch: this.epoch, ...(resync ? { resync: true as const } : {}) };
  }

  readonly fetch = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/sync.pull")) {
      return Promise.resolve(reply(this.pull(parseJsonWith(pullInput, url.searchParams.get("input") ?? "{}")["0"].json)));
    }
    if (url.pathname.endsWith("/sync.push") && typeof init?.body === "string") {
      const { entity, row } = parseJsonWith(pushInput, init.body)["0"].json;
      this.log.push({ entity, row });
      return Promise.resolve(reply({ status: "accepted", row }));
    }
    return Promise.reject(new Error(`fejkservern svarar inte på ${url.pathname}`));
  };
}

/** En flik: en egen store över webbläsarprofilens gemensamma lagring. */
function openTab(server: FakeSyncServer, factory: IDBFactory, who: LocalScope, extra: Partial<ServerFirstStoreDeps> = {}): Promise<CachingSyncDataStore> {
  return createServerFirstStore({
    baseUrl: "http://ava.test",
    fetch: server.fetch,
    local: { factory, ns: userNamespace(who), adoptsLegacy: false },
    rejected: { changes: new RejectedChanges(), persistence: new InMemoryRejectedChangesPersistence() },
    ...extra,
  });
}

const contactIds = async (tab: CachingSyncDataStore): Promise<string[]> =>
  (await tab.store.contacts.findMany({})).map((c) => c.id).sort();

describe("createServerFirstStore — cursorn sparas mellan sidladdningar (#1711)", () => {
  it("en omladdad flik fortsätter från den sparade cursorn och skickar den sparade epoken", async () => {
    const server = new FakeSyncServer();
    const factory = new IDBFactory();
    server.add(contact(ROW_1), contact(ROW_2));
    await openTab(server, factory, anna);
    expect(server.pulls).toEqual([{ sinceCursor: 0 }]);

    const reloaded = await openTab(server, factory, anna);
    expect(server.pulls[1]).toEqual({ sinceCursor: 2, epoch: EPOCH });
    expect(await contactIds(reloaded)).toEqual([ROW_1, ROW_2]);
  });

  it("cursorn ligger i snapshotets databas i användarens namnrymd, aldrig under standardnamnet", async () => {
    const server = new FakeSyncServer();
    const factory = new IDBFactory();
    server.add(contact(ROW_1));
    await openTab(server, factory, anna);
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).not.toContain("ava-sync-cursor");
    const kv = new IdbKv(factory, dbNameIn(userNamespace(anna), LOCAL_DB.localStore), "source");
    expect(await kv.get("sync")).toEqual({ cursor: 1, epoch: EPOCH });
  });

  it("två användare i samma webbläsarprofil delar inte cursor", async () => {
    const server = new FakeSyncServer();
    const factory = new IDBFactory();
    server.add(contact(ROW_1));
    await openTab(server, factory, anna);
    const hers = await openTab(server, factory, bea);
    expect(server.pulls[1]).toEqual({ sinceCursor: 0 });
    expect(await contactIds(hers)).toEqual([ROW_1]);
  });

  it("saknas snapshotet börjar synken från 0, även om en position finns sparad", async () => {
    const server = new FakeSyncServer();
    const factory = new IDBFactory();
    server.add(contact(ROW_1));
    await new IdbKv(factory, dbNameIn(userNamespace(anna), LOCAL_DB.localStore), "source").put("sync", { cursor: 1, epoch: EPOCH });
    const tab = await openTab(server, factory, anna);
    expect(server.pulls).toEqual([{ sinceCursor: 0 }]);
    expect(await contactIds(tab)).toEqual([ROW_1]);
  });

  it("bindningsfasen sparar ingen cursor: nästa start börjar från 0", async () => {
    const server = new FakeSyncServer();
    server.add(contact(ROW_1));
    const binding = { baseUrl: "http://ava.test", fetch: server.fetch, local: "binding" as const, rejected: { changes: new RejectedChanges(), persistence: new InMemoryRejectedChangesPersistence() } };
    await createServerFirstStore(binding);
    await createServerFirstStore({ ...binding, rejected: { changes: new RejectedChanges(), persistence: new InMemoryRejectedChangesPersistence() } });
    expect(server.pulls).toEqual([{ sinceCursor: 0 }, { sinceCursor: 0 }]);
  });
});

describe("två flikar över samma lagring (#1711): cursorn är aldrig före snapshotet", () => {
  it("fliken som saknar de senaste raderna skriver sist — ingen rad saknas efteråt", async () => {
    const server = new FakeSyncServer();
    const factory = new IDBFactory();
    server.add(contact(ROW_1));
    const a = await openTab(server, factory, anna);
    const b = await openTab(server, factory, anna);

    // A hämtar den nya raden och sparar snapshot + cursor 2.
    server.add(contact(ROW_2));
    await a.reconcile();
    expect(await contactIds(a)).toEqual([ROW_1, ROW_2]);

    // B, som inte har raden, sparar sitt snapshot sist (en lokal ändring).
    await b.store.contacts.create({ data: contact(LOCAL) });
    expect(await contactIds(b)).toEqual([LOCAL, ROW_1].sort());

    // En ny flik hydrerar B:s snapshot — med B:s position, inte A:s.
    const fresh = await openTab(server, factory, anna, { skipInitialReconcile: true });
    expect(await contactIds(fresh)).toEqual([LOCAL, ROW_1].sort());
    server.pulls.length = 0;
    await fresh.reconcile();
    expect(server.pulls[0]).toEqual({ sinceCursor: 1, epoch: EPOCH });
    expect(await contactIds(fresh)).toEqual([LOCAL, ROW_1, ROW_2].sort());

    // B tog aldrig över A:s cursor: den hämtar raden själv.
    await b.reconcile();
    expect(await contactIds(b)).toEqual([LOCAL, ROW_1, ROW_2].sort());
  });
});

describe("omladdning efter en återställd databas (#1711, #1360)", () => {
  it("första reconcilen ger resync och prune; rader med köade ändringar ligger kvar", async () => {
    const server = new FakeSyncServer();
    const factory = new IDBFactory();
    server.add(contact(ROW_1), contact(ROW_2));
    const before = await openTab(server, factory, anna);
    // En ändring som inte hunnit synkas när databasen återställs.
    await before.store.contacts.create({ data: contact(LOCAL) });

    server.restoreFromBackup(contact(ROW_1));
    const reloaded = await openTab(server, factory, anna, { skipInitialReconcile: true });
    expect(await contactIds(reloaded)).toEqual([LOCAL, ROW_1, ROW_2].sort());
    server.pulls.length = 0;
    const result = await reloaded.reconcile();

    expect(server.pulls[0]).toEqual({ sinceCursor: 2, epoch: EPOCH });
    expect(result.pruned).toBe(1);
    expect(result.pushed).toBe(1);
    expect(await contactIds(reloaded)).toEqual([LOCAL, ROW_1].sort());

    // Den nya epoken är sparad: nästa omladdning synkar inte om igen. Cursorn
    // står på sidans slut (1) — den egna, nyss skickade raden hämtas igen.
    server.pulls.length = 0;
    await openTab(server, factory, anna);
    expect(server.pulls[0]).toEqual({ sinceCursor: 1, epoch: RESTORED });
  });
});
