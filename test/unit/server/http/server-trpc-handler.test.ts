/**
 * Integrationstest för server-first tRPC-over-HTTP-handlern (#410, ADR 0016).
 *
 * Driver handlern via en RIKTIG tRPC-`httpBatchLink`-klient med injicerad
 * `fetch` (samma transport som web-appens HttpDataStore, #411). Verifierar
 * AC för #410:
 *   - HTTP-tRPC-endpoint live (routern körs över HTTP mot Drizzle-repos).
 *   - Principal verifieras SERVER-SIDE ur forwarded email-header.
 *   - `protectedProcedure`/`orgProcedure` enforce:as server-side (ingen
 *     identitet → UNAUTHORIZED; med identitet → org-scopad data).
 */

import { createTRPCClient, httpBatchLink, TRPCClientError } from "@trpc/client";
import superjson from "superjson";
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { users } from "@/lib/server/db/schema";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { AppRouter } from "@/lib/server/routers/_app";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const ANNA = uuidv7();

function makeClient(handler: (req: Request) => Promise<Response>, email?: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: "http://ava.test/api/trpc",
        transformer: superjson,
        headers: () => (email ? { "X-Auth-Request-Email": email } : {}),
        fetch: (input, init) => handler(new Request(input as string, init as RequestInit)),
      }),
    ],
  });
}

describe("createServerTrpcHandler (#410)", () => {
  let handle: TestDbHandle;
  let handler: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    handle = await createTestDb();
    const repos = buildDrizzleRepositories(handle.db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await handle.db.insert(users).values(
      v({ id: ANNA, organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true }),
    );
    handler = createServerTrpcHandler({ repos, ports: noopPorts, organizationId: ORG });
  });
  afterAll(async () => { await handle.close(); });

  it("kör en protectedProcedure med server-verifierad principal", async () => {
    const me = await makeClient(handler, "anna@byra.se").user.current.query();
    expect(me).toMatchObject({ id: ANNA, email: "anna@byra.se", role: "LAWYER" });
  });

  it("enforce:ar protectedProcedure server-side — ingen identitet → UNAUTHORIZED", async () => {
    await expect(makeClient(handler).user.current.query()).rejects.toBeInstanceOf(TRPCClientError);
  });

  it("enforce:ar orgProcedure server-side — org-scopad query lyckas med principal", async () => {
    const res = await makeClient(handler, "anna@byra.se").contacts.list.query({});
    expect(res).toMatchObject({ contacts: [], total: 0 });
  });

  it("orgProcedure utan identitet → UNAUTHORIZED", async () => {
    await expect(makeClient(handler).contacts.list.query({})).rejects.toBeInstanceOf(TRPCClientError);
  });
});
