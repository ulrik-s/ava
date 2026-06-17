/**
 * `HttpBackendRuntime` (#411) — den "alltid-online"-väg som server-first-
 * backenden använder. Drivs end-to-end mot den RIKTIGA server-runtime-handlern
 * (`createServerTrpcHandler`, #410) via en injicerad `fetch` som simulerar
 * oauth2-proxy:s forwarded headers → bevisar att klienten är wire-kompatibel
 * med servern (samma `/api/trpc`, superjson, server-verifierad principal).
 *
 * Detta är "PostgresBackendRuntime droppar in" (jfr backend-runtime-
 * pluggability): samma `createTRPCClient(runtime.createLink())`-konsument-väg
 * som GitBackendRuntime, fast routrarna körs på servern.
 */

import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import {
  HttpBackendRuntime,
  serverTrpcEndpoint,
  type HttpBackendFetch,
} from "@/lib/client/backend/http-backend-runtime";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { users } from "@/lib/server/db/schema";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { AppRouter } from "@/lib/server/routers/_app";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../../server/db/pg-test-db";

const ORG = uuidv7();
const ANNA = uuidv7();

/** Klient byggd via runtime:ns länk (samma väg som web-app-providern). */
function clientVia(fetch: HttpBackendFetch) {
  const link = new HttpBackendRuntime({ baseUrl: "https://byra.example", fetch }).createLink();
  return createTRPCClient<AppRouter>({ links: [link as TRPCLink<AppRouter>] });
}

describe("serverTrpcEndpoint", () => {
  it("samma origin (tom bas) → /api/trpc", () => {
    expect(serverTrpcEndpoint()).toBe("/api/trpc");
  });
  it("lägger på /api/trpc och trimmar avslutande slash", () => {
    expect(serverTrpcEndpoint("https://byra.example")).toBe("https://byra.example/api/trpc");
    expect(serverTrpcEndpoint("https://byra.example///")).toBe("https://byra.example/api/trpc");
  });
});

describe("HttpBackendRuntime (#411) — end-to-end mot server-runtimen", () => {
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

  /** Fetch som routar till server-handlern; `email` simulerar oauth2-proxy:s
   *  forwarded `X-Auth-Request-Email` (det nginx sätter i deployen). */
  const fetchVia = (email?: string): HttpBackendFetch => (input, init) => {
    const headers = new Headers(init?.headers);
    if (email) headers.set("X-Auth-Request-Email", email);
    return handler(new Request(input as string, { ...init, headers }));
  };

  it("server-verifierad principal → user.current end-to-end", async () => {
    const me = await clientVia(fetchVia("anna@byra.se")).user.current.query();
    expect(me).toMatchObject({ id: ANNA, email: "anna@byra.se", role: "LAWYER" });
    expect(me.createdAt).toBeInstanceOf(Date); // superjson round-trippade en Date
  });

  it("org-scopad orgProcedure round-trippar (contacts.list)", async () => {
    const res = await clientVia(fetchVia("anna@byra.se")).contacts.list.query({});
    expect(res).toMatchObject({ contacts: [], total: 0 });
  });

  it("ingen forwarded identitet → klienten kastar (UNAUTHORIZED server-side)", async () => {
    await expect(clientVia(fetchVia()).user.current.query()).rejects.toThrow();
  });
});
