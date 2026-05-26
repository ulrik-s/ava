/**
 * Tester för `createDemoTrpcLink` — bekräftar att in-memory tRPC-
 * länken faktiskt routar queries genom appRouter mot DemoDataStore.
 */

import { describe, it, expect } from "vitest";
import { createTRPCClient } from "@trpc/client";
import superjson from "superjson";
import type { AppRouter } from "@/lib/server/routers/_app";
import { createDemoTrpcLink } from "@/lib/client/demo/demo-trpc-link";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";

const matters = [
  { id: "m1", title: "Demo Avtal", organizationId: "demo-firma-ab", status: "ACTIVE", matterNumber: "2025-0001", createdAt: new Date("2025-01-01") },
  { id: "m2", title: "Annan Tvist", organizationId: "demo-firma-ab", status: "CLOSED", matterNumber: "2025-0002", createdAt: new Date("2025-02-01") },
];

const contacts = [
  { id: "c1", name: "Anna", organizationId: "demo-firma-ab", contactType: "PRIVATPERSON" },
];

const buildClient = () => {
  const dataStore = new DemoDataStore({ matters, contacts });
  return createTRPCClient<AppRouter>({
    links: [createDemoTrpcLink({ dataStore })],
    transformer: superjson,
  } as never);
};

describe("createDemoTrpcLink", () => {
  it("query går igenom appRouter till DemoDataStore", async () => {
    const client = buildClient();
    // matter-router list-procedure — använd default-args (page/pageSize default)
    const result = await (client as unknown as { matter: { list: { query: (i: unknown) => Promise<{ matters: unknown[]; total: number }> } } })
      .matter.list.query({});
    expect(result.matters.length).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it("mutation kastar (read-only via DemoDataStore)", async () => {
    const client = buildClient();
    await expect(
      (client as unknown as { matter: { create: { mutate: (i: unknown) => Promise<unknown> } } })
        .matter.create.mutate({ title: "Ny" }),
    ).rejects.toThrow();
  });
});
