/**
 * Server-first E2E över en RIKTIG HTTP-socket (#470, steg mot #422).
 *
 * Till skillnad från `trpc-sync-transport.test.ts` (injicerad `fetch`) startar
 * detta server-first-handlern på en `node:http`-socket via `serveFetchHandler`
 * och driver `sync.pull`/`sync.push` genom en RIKTIG `httpBatchLink`-klient över
 * `http://127.0.0.1:<port>` — täcker `node-http-adapter` + HTTP-transporten +
 * sync-routern + `DrizzleSyncStore` end-to-end över tråden. pglite/Postgres via
 * createTestDb.
 */

import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import superjson from "superjson";
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { TrpcSyncTransport } from "@/lib/client/sync/trpc-sync-transport";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import { InMemoryMutationQueuePersistence, type QueuedMutation, type QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DrizzleSyncDevices } from "@/lib/server/sync/drizzle-sync-devices";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { DemoSource } from "@/lib/shared/demo-source";
import { serveFetchHandler } from "@/lib/shared/http/node-http-adapter";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const ANNA = uuidv7();

/**
 * `fetch` via `node:http` — kringgår happy-dom:s Same-Origin-grind (testmiljön
 * blockerar cross-origin `globalThis.fetch`). Ger en RIKTIG socket-roundtrip mot
 * server-handlern (täcker `node-http-adapter`).
 */
function nodeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input.toString());
  const headers: Record<string, string> = {};
  new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => { headers[k] = v; });
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: init?.method ?? "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(new Response(Buffer.concat(chunks).toString("utf8"), {
          status: res.statusCode ?? 200,
          headers: { "content-type": String(res.headers["content-type"] ?? "application/json") },
        })));
      },
    );
    req.on("error", reject);
    if (init?.body) req.write(init.body as string);
    req.end();
  });
}

function clientFor(baseUrl: string, email?: string): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${baseUrl}/api/trpc`,
        transformer: superjson,
        headers: () => (email ? { "X-Auth-Request-Email": email } : {}),
        fetch: nodeFetch as never,
      }),
    ],
  });
}

describe("server-first E2E över riktig HTTP-socket (#470)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let server: Server;
  let baseUrl: string;
  let transport: TrpcSyncTransport;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await handle.db.insert(users).values(
      v({ id: ANNA, organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true }),
    );
    const handler = createServerTrpcHandler({
      repos, ports: noopPorts, organizationId: ORG, sync: new DrizzleSyncStore(handle.db, repos),
      replayer: new DrizzleProcedureReplayer(handle.db, repos),
      syncDevices: new DrizzleSyncDevices(handle.db),
    });
    server = serveFetchHandler(handler, { port: 0 });
    await once(server, "listening");
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    transport = new TrpcSyncTransport(clientFor(baseUrl, "anna@byra.se"));
  });

  afterAll(async () => {
    server.close();
    await handle.close();
  });

  it("enhetens synkläge rapporteras över riktig socket och sparas för den inloggade (#1267)", async () => {
    const deviceId = uuidv7();
    const client = clientFor(baseUrl, "anna@byra.se");
    expect(await client.sync.reportDevice.mutate({ deviceId, label: "Chrome på macOS", pendingCount: 2, oldestPendingAt: 1000 })).toEqual({ ok: true });
    const [row] = (await new DrizzleSyncDevices(handle.db).list(ORG)).filter((d) => d.deviceId === deviceId);
    expect(row).toMatchObject({ userId: ANNA, pendingCount: 2, oldestPendingAt: 1000 });
    // Bara admin ser listan — Anna är jurist.
    await expect(client.sync.devices.query()).rejects.toThrow();
  });

  it("pull:ar server-skapade rader över riktig socket", async () => {
    const m1 = uuidv7();
    await repos.matters.create({ id: m1, organizationId: ORG, title: "Wire-ärende", status: "ACTIVE", matterNumber: "2026-0012" } as never);
    const res = await transport.pull(0);
    expect(res.cursor).toBeGreaterThan(0);
    expect(res.changes.some((c) => c.row.id === m1)).toBe(true);
  });

  it("push:ar en mutation som applikeras server-auktoritativt över riktig socket", async () => {
    const c1 = uuidv7();
    const mutation: QueuedMutation = {
      mutationId: uuidv7(), entity: "contact", kind: "create",
      row: { id: c1, organizationId: ORG, name: "Wire-kontakt" }, enqueuedAt: 0,
    };
    expect((await transport.push(mutation)).status).toBe("accepted");
    expect(await repos.contacts.getById(asId<"ContactId">(c1))).toMatchObject({ id: c1, name: "Wire-kontakt" });
  });

  it("spelar upp ett procedur-anrop auktoritativt över riktig socket, som den inloggade (#1265)", async () => {
    const matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Kö-ärende", status: "ACTIVE", matterNumber: "2026-1266" } as never);
    const id = uuidv7();
    const res = await transport.pushProcedure({
      type: "procedure", mutationId: uuidv7(), path: "timeEntry.create", codeVersion: "t", enqueuedAt: 0,
      input: { id, matterId, date: "2026-09-02", minutes: 45, description: "Förhandling" },
      touches: [{ entity: "timeEntry", id }],
    });
    expect(res.status).toBe("accepted");
    expect(res.rows[0]).toMatchObject({ entity: "timeEntry", row: { id, minutes: 45 } });
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toMatchObject({ userId: ANNA });
  });

  describe("avvisad ändring lämnar ingen spökrad (#1348)", () => {
    /** En klient med en egen lokal kopia (seed) och kö, mot den riktiga servern. */
    async function client(seed: DemoSource, queued: QueueEntry[] = []) {
      const persistence = new InMemoryPersistence(seed);
      return CachingSyncDataStore.create({ transport, persistence, queuePersistence: new InMemoryMutationQueuePersistence(queued) });
    }

    it("radkonflikt med serverns rad: den lokala tidsposten blir serverns", async () => {
      const matterId = uuidv7();
      await repos.matters.create({ id: matterId, organizationId: ORG, title: "Spök-ärende", status: "ACTIVE", matterNumber: "2026-1348" } as never);
      const entry = await repos.timeEntries.create({ id: uuidv7(), matterId, userId: ANNA, date: new Date("2026-09-30"), minutes: 30, description: "Serverns", hourlyRate: 1500 } as never);
      const ds = await client({});
      await ds.reconcile(); // serverns läge lokalt
      // En äldre klient köade tidsposten som en rad (procedurägd → avvisas, #1242).
      await ds.store.timeEntries.update({ where: { id: entry.id }, data: { minutes: 600, description: "Spöke" } as never });
      const res = await ds.reconcile();
      expect(res.conflicts).toMatchObject([{ retryable: false, current: { id: entry.id } }]);
      const local = await ds.store.timeEntries.findUnique({ where: { id: entry.id } });
      expect(local).toMatchObject({ minutes: 30, description: "Serverns" });
    });

    it("avvisat skapande utan serverns rad: den lokala kontakten försvinner", async () => {
      const id = uuidv7();
      const ds = await client({});
      // En kontakt i en annan byrå avvisas ("annan byrå") — servern har ingen sådan rad.
      await ds.store.contacts.create({ data: { id, organizationId: uuidv7(), name: "Spökkontakt" } as never });
      const res = await ds.reconcile();
      expect(res.conflicts).toMatchObject([{ reason: "annan byrå", retryable: false }]);
      expect(await ds.store.contacts.findUnique({ where: { id } })).toBeNull();
      expect(await repos.contacts.getById(asId<"ContactId">(id))).toBeNull();
    });

    it("avvisning som klienten klassar (servern kastar BAD_REQUEST): raden hämtas och blir serverns", async () => {
      const id = uuidv7();
      await repos.contacts.create({ id, organizationId: ORG, name: "Serverns namn" } as never);
      const server = await repos.contacts.getById(asId<"ContactId">(id));
      // Köposten har ett köformat servern inte tar emot (zod) — den avvisas deterministiskt.
      const broken: QueueEntry = { mutationId: uuidv7(), entity: "contact", kind: "update", row: { id, organizationId: ORG, name: "Lokalt namn" }, enqueuedAt: 0, format: 0 };
      const ds = await client({ contacts: [{ id, organizationId: ORG, name: "Lokalt namn" }] }, [broken]);
      const res = await ds.reconcile();
      expect(res.conflicts).toMatchObject([{ reason: expect.stringMatching(/^Servern avvisade ändringen/), retryable: false }]);
      expect(res.restored).toBeGreaterThanOrEqual(1);
      const local = await ds.store.contacts.findUnique({ where: { id } });
      expect(local).toMatchObject({ id, name: "Serverns namn", version: server?.version });
    });
  });

  it("orgProcedure-grind: ingen forwarded identitet → klienten kastar", async () => {
    await expect(clientFor(baseUrl).sync.pull.query({ sinceCursor: 0 })).rejects.toThrow();
  });
});
