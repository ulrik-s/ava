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
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { serveFetchHandler } from "@/lib/server/http/node-http-adapter";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();

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
  let repos: Repositories;
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
      v({ id: uuidv7(), organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true }),
    );
    const handler = createServerTrpcHandler({
      repos, ports: noopPorts, organizationId: ORG, sync: new DrizzleSyncStore(handle.db, repos),
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
    expect(await repos.contacts.getById(c1)).toMatchObject({ id: c1, name: "Wire-kontakt" });
  });

  it("orgProcedure-grind: ingen forwarded identitet → klienten kastar", async () => {
    await expect(clientFor(baseUrl).sync.pull.query({ sinceCursor: 0 })).rejects.toThrow();
  });
});
