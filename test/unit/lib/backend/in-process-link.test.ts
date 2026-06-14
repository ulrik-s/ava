/**
 * Kloss 3 — `inProcessLink` (Git-backendens transport).
 *
 * Täcker felvägarna som GitBackendRuntime-testet inte träffar:
 *   - okänd procedure-path → NOT_FOUND
 *   - router som kastar TRPCError (UNAUTHORIZED) → passerar igenom oförändrad
 *   - ports-override i GitBackendRuntime
 */

import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { describe, it, expect } from "vitest-compat";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { inProcessLink } from "@/lib/client/demo/in-process-link";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { AppRouter } from "@/lib/server/routers/_app";

const store = () => new DemoDataStore({
  matters: [{ id: "m1", title: "T", organizationId: "demo-firma-ab", status: "ACTIVE", matterNumber: "2025-0001", createdAt: new Date() }],
});

function rawClient(runtime: GitBackendRuntime) {
  return createTRPCClient<AppRouter>({ links: [runtime.createLink()], transformer: superjson } as never) as unknown as Record<string, never>;
}

describe("inProcessLink — felvägar", () => {
  it("okänd procedure-path → NOT_FOUND", async () => {
    const client = rawClient(new GitBackendRuntime({ dataStore: store() })) as unknown as {
      doesNot: { exist: { query: (i: unknown) => Promise<unknown> } };
    };
    await expect(client.doesNot.exist.query({})).rejects.toThrow(/No procedure/i);
  });

  it("router som kastar TRPCError passerar igenom (null-principal → UNAUTHORIZED)", async () => {
    const runtime = new GitBackendRuntime({
      dataStore: store(),
      authProvider: { getPrincipal: () => null }, // anonym → orgProcedure kastar UNAUTHORIZED
    });
    const client = rawClient(runtime) as unknown as {
      matter: { list: { query: (i: unknown) => Promise<unknown> } };
    };
    await expect(client.matter.list.query({})).rejects.toThrow(/UNAUTHORIZED|unauthorized/i);
  });

  it("direkt länk-invokation: okänd path → observer.error (caller-proxyn kastar)", async () => {
    // Driver länken direkt (utan createTRPCClient) → täcker observable-
    // error-vägen. "matter" är en namespace, inte en procedure.
    const ds = store();
    const ctx = buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal: new GitAuthProvider().getPrincipal() });
    const op = { type: "query" as const, path: "matter", input: {}, id: 0, context: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = (inProcessLink(ctx) as any)({})({ op, next: () => {} });
    await expect(
      new Promise((resolve, reject) => result.subscribe({ next: resolve, error: reject })),
    ).rejects.toThrow(/No procedure/i);
  });

  it("GitBackendRuntime respekterar injicerade ports", async () => {
    const ds = store();
    const ports = buildGitPorts(ds);
    const runtime = new GitBackendRuntime({
      dataStore: ds,
      ports,
      authProvider: new GitAuthProvider({ organizationId: "demo-firma-ab", id: "t" }),
    });
    const client = rawClient(runtime) as unknown as {
      matter: { list: { query: (i: unknown) => Promise<{ matters: unknown[] }> } };
    };
    const res = await client.matter.list.query({});
    expect(res.matters.length).toBeGreaterThanOrEqual(1);
  });
});
