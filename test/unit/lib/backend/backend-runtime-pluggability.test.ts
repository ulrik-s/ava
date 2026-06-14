/**
 * Kloss 4 — bevisa att `BackendRuntime` är en KORREKT abstraktion: en
 * helt icke-git-kopplad backend kan pluggas in genom EXAKT samma
 * konsument-väg (createTRPCClient + runtime.createLink()) som
 * GitBackendRuntime.
 *
 * Det här är skyddsräcket för ADR 0001/0003: om någon råkar git-koppla
 * konsument-vägen (t.ex. importerar DemoDataStore i bootstrap utanför
 * runtime:n) så faller det här testet inte — men det dokumenterar och
 * låser att seamen är det enda som krävs för att byta backend. När
 * `PostgresBackendRuntime` (httpBatchLink) byggs ska den droppa in här.
 */

import { createTRPCClient, type TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import superjson from "superjson";
import { describe, it, expect } from "vitest-compat";
import type { BackendRuntime } from "@/lib/client/backend/backend-runtime";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { AppRouter } from "@/lib/server/routers/_app";

/**
 * En fejk-backend som INTE rör git/DemoDataStore alls — den simulerar en
 * server-backend genom att svara med kanned data. Poängen: konsumenten
 * (createTRPCClient) beror bara på `BackendRuntime.createLink()`.
 */
class FakeServerBackendRuntime implements BackendRuntime {
  constructor(private readonly canned: { matters: unknown[]; total: number }) {}

  createLink(): TRPCLink<AppRouter> {
    const canned = this.canned;
    return () => ({ op }) =>
      observable((observer) => {
        // Ingen git, ingen DemoDataStore, ingen appRouter — ren server-sim.
        const data = op.path === "matter.list" ? canned : null;
        observer.next({ result: { data } });
        observer.complete();
        return () => {};
      });
  }
}

function clientFor(runtime: BackendRuntime) {
  return createTRPCClient<AppRouter>({
    links: [runtime.createLink()],
    transformer: superjson,
  } as never) as unknown as {
    matter: { list: { query: (i: unknown) => Promise<{ matters: unknown[]; total: number }> } };
  };
}

describe("BackendRuntime — pluggbarhet (kloss-socket)", () => {
  it("en icke-git backend kan pluggas in genom samma konsument-väg", async () => {
    const fake = new FakeServerBackendRuntime({ matters: [{ id: "srv-1" }], total: 1 });
    const result = await clientFor(fake).matter.list.query({});
    expect(result.matters).toEqual([{ id: "srv-1" }]);
    expect(result.total).toBe(1);
  });

  it("git- och fake-backend är utbytbara bakom samma BackendRuntime-typ", async () => {
    // Samma konsument-kod, två olika backend-implementationer.
    const runtimes: BackendRuntime[] = [
      new GitBackendRuntime({
        dataStore: new DemoDataStore({
          matters: [{ id: "m1", title: "T", organizationId: "demo-firma-ab", status: "ACTIVE", matterNumber: "2025-0001", createdAt: new Date() }],
        }),
        authProvider: new GitAuthProvider({ organizationId: "demo-firma-ab", id: "t" }),
      }),
      new FakeServerBackendRuntime({ matters: [{ id: "srv-1" }], total: 1 }),
    ];
    for (const runtime of runtimes) {
      const res = await clientFor(runtime).matter.list.query({});
      expect(res.matters.length).toBeGreaterThanOrEqual(1);
    }
  });
});
