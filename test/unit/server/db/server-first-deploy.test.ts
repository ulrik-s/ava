/**
 * Server-first DEPLOY-verifiering (steg mot server-first, #422-grund): kör den
 * RIKTIGA produktionswiringen `buildServerFirstApi` (→ `createPostgresDb` →
 * Drizzle-repos + change_log + DrizzleSyncStore) mot en **migrerad** Postgres
 * (publikt schema via `db:migrate`-logiken) över en riktig HTTP-socket, och
 * synkar via `TrpcSyncTransport`.
 *
 * Bevisar att server-first kan DEPLOYAS: `createPostgresDb` ansluter bara —
 * schemat måste appliceras (`applyMigrations`) först. Körs bara när PG_TEST_URL
 * är satt (CI:s Postgres-jobb); hoppas annars (pglite delar inte publikt schema).
 */

import { once } from "node:events";
import { request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import postgres from "postgres";
import superjson from "superjson";
import { describe, it, expect } from "vitest-compat";
import { TrpcSyncTransport } from "@/lib/client/sync/trpc-sync-transport";
import { buildServerFirstApi } from "@/lib/server/http/server-first-api";
import type { AppRouter } from "@/lib/server/routers/_app";
import { serveFetchHandler } from "@/lib/shared/http/node-http-adapter";
import { uuidv7 } from "@/lib/shared/uuid";
import { applyMigrations } from "../../../../tooling/scripts/db-migrate";

const url = process.env.PG_TEST_URL;
const itPg = url ? it : it.skip;

/** node:http-fetch (kringgår happy-dom:s Same-Origin-grind) → riktig socket. */
function nodeFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const u = new URL(typeof input === "string" ? input : input.toString());
  const headers: Record<string, string> = {};
  new Headers(init?.headers as HeadersInit | undefined).forEach((v, k) => { headers[k] = v; });
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: init?.method ?? "GET", headers },
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

describe("server-first deploy (migrerad Postgres, riktig socket)", () => {
  itPg("buildServerFirstApi synkar mot migrerad Postgres över HTTP", async () => {
    const dbUrl = url as string;
    const org = uuidv7();

    // 1. Återställ + migrera publikt schema (det `createPostgresDb` ser), seed user.
    const admin = postgres(dbUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;`);
    await applyMigrations(admin);
    await admin.unsafe(
      `INSERT INTO users (id, organization_id, email, name, role, active)
       VALUES ($1, $2, 'anna@byra.se', 'Anna', 'LAWYER', true)`,
      [uuidv7(), org],
    );
    await admin.end({ timeout: 5 });

    // 2. Den RIKTIGA produktionswiringen mot migrerad PG, serverad på en socket.
    const api = buildServerFirstApi({ databaseUrl: dbUrl, organizationId: org, maxConnections: 4 });
    const server: Server = serveFetchHandler(api.handler, { port: 0 });
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    try {
      const client: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url: `http://127.0.0.1:${port}/api/trpc`,
            transformer: superjson,
            headers: () => ({ "X-Auth-Request-Email": "anna@byra.se" }),
            fetch: nodeFetch as never,
          }),
        ],
      });
      const transport = new TrpcSyncTransport(client);

      // 3. Push en mutation server-auktoritativt; verifiera via pull.
      const m1 = uuidv7();
      const push = await transport.push({
        mutationId: uuidv7(), entity: "matter", kind: "create",
        row: { id: m1, organizationId: org, title: "Deploy-ärende", status: "ACTIVE", matterNumber: "2026-0099" },
        enqueuedAt: 0,
      });
      expect(push.status).toBe("accepted");

      const pulled = await transport.pull(0);
      expect(pulled.changes.some((c) => c.row.id === m1)).toBe(true);
    } finally {
      server.close();
      await api.close();
    }
  });
});
