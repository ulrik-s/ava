/**
 * Kloss 3 — `GitBackendRuntime`.
 *
 * Bekräftar att Git-backendens in-process-länk routar queries genom
 * appRouter mot DemoDataStore, att read-only-mutationer kastar, och att
 * principalen (org-scoping) styrs via en injicerad AuthProvider.
 */

import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import { describe, it, expect } from "vitest-compat";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import type { AppRouter } from "@/lib/server/routers/_app";

const matters = [
  { id: "m1", title: "Demo Avtal", organizationId: "demo-firma-ab", status: "ACTIVE", matterNumber: "2025-0001", createdAt: new Date("2025-01-01") },
  { id: "m2", title: "Annan Tvist", organizationId: "demo-firma-ab", status: "CLOSED", matterNumber: "2025-0002", createdAt: new Date("2025-02-01") },
];
const contacts = [{ id: "c1", name: "Anna", organizationId: "demo-firma-ab", contactType: "PRIVATPERSON" }];

function buildClient(runtime: GitBackendRuntime) {
  return createTRPCClient<AppRouter>({
    links: [runtime.createLink()],
    transformer: superjson,
  } as never) as unknown as {
    matter: {
      list: { query: (i: unknown) => Promise<{ matters: unknown[]; total: number }> };
      create: { mutate: (i: unknown) => Promise<unknown> };
    };
  };
}

const seedOrgPrincipal = new GitAuthProvider({ organizationId: "demo-firma-ab", id: "test-user" });

describe("GitBackendRuntime", () => {
  it("query går igenom appRouter till DemoDataStore (explicit principal scopar demo-firma-ab)", async () => {
    const runtime = new GitBackendRuntime({ dataStore: new DemoDataStore({ matters, contacts }), authProvider: seedOrgPrincipal });
    const result = await buildClient(runtime).matter.list.query({});
    expect(result.matters.length).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it("mutation kastar (read-only via DemoDataStore)", async () => {
    const runtime = new GitBackendRuntime({ dataStore: new DemoDataStore({ matters, contacts }), authProvider: seedOrgPrincipal });
    await expect(buildClient(runtime).matter.create.mutate({ title: "Ny" })).rejects.toThrow();
  });

  it("injicerad AuthProvider styr org-scoping → fel org ger 0 träffar", async () => {
    const runtime = new GitBackendRuntime({
      dataStore: new DemoDataStore({ matters, contacts }),
      authProvider: new GitAuthProvider({ organizationId: "annan-org" }),
    });
    const result = await buildClient(runtime).matter.list.query({});
    expect(result.matters).toHaveLength(0);
  });
});
