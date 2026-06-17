/**
 * Enhetstest för den delade add-in-tRPC-klienten (#83, ADR 0013).
 *
 * Driver `createAddinClient` mot den RIKTIGA server-handlern
 * (`createTrpcHttpHandler`) via en injicerad `fetch` → bevisar att add-in-
 * klienten är wire-kompatibel med servern: samma `/api/trpc`-endpoint,
 * superjson-transformer och Bearer-PAT-auth. Detta är hela poängen med
 * "add-ins är tunna tRPC-klienter".
 */
import { describe, it, expect } from "vitest-compat";
import { createAddinClient, addinTrpcEndpoint, type AddinFetch } from "@/lib/client/addin/addin-client";
import type { Principal } from "@/lib/server/auth/principal";
import type { IDataStore } from "@/lib/server/data-store/IDataStore";
import { StaticPatVerifier, patRecord } from "@/lib/server/http/pat";
import { createTrpcHttpHandler } from "@/lib/server/http/trpc-http-handler";
import { buildInMemoryRepositories } from "@/lib/server/repositories/in-memory-repositories";
import type { Context } from "@/lib/server/trpc-core";

const PRINCIPAL: Principal = {
  id: "p-1", email: "advokat@byra.se", name: "Ada Advokat",
  role: "LAWYER", organizationId: "org-1",
};

/** Server-handler med fake-context (user.current faller tillbaka på ctx.user). */
function serverHandler() {
  const verifier = new StaticPatVerifier([patRecord("good-token", PRINCIPAL)]);
  const dataStore = { users: { findFirst: async () => null } } as unknown as IDataStore;
  const context = {
    dataStore, ports: {}, user: PRINCIPAL,
    repos: buildInMemoryRepositories(dataStore),
  } as unknown as Context;
  return createTrpcHttpHandler({
    verifier,
    openSession: () => ({ context, finalize: async () => {} }),
  });
}

/** Add-in-klient som routar via en given server-handler (i st.f. nätet). */
function clientVia(handler: (req: Request) => Promise<Response>, token: string) {
  const fetchImpl: AddinFetch = (input, init) => handler(new Request(input, init));
  return createAddinClient({ baseUrl: "https://byra.example/", token, fetch: fetchImpl });
}

describe("addinTrpcEndpoint", () => {
  it("lägger på /api/trpc och trimmar avslutande slash", () => {
    expect(addinTrpcEndpoint("https://byra.example")).toBe("https://byra.example/api/trpc");
    expect(addinTrpcEndpoint("https://byra.example/")).toBe("https://byra.example/api/trpc");
    expect(addinTrpcEndpoint("https://byra.example///")).toBe("https://byra.example/api/trpc");
  });
});

describe("createAddinClient", () => {
  it("giltig PAT → user.current returnerar principalen (end-to-end mot servern)", async () => {
    const client = clientVia(serverHandler(), "good-token");
    const me = await client.user.current.query();
    expect(me.email).toBe(PRINCIPAL.email);
    expect(me.name).toBe(PRINCIPAL.name);
    expect(me.createdAt).toBeInstanceOf(Date); // superjson round-trippade en Date
  });

  it("fel PAT → 401 → klienten kastar", async () => {
    const client = clientVia(serverHandler(), "wrong-token");
    await expect(client.user.current.query()).rejects.toThrow();
  });
});
