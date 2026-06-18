/**
 * Enhetstest för den delade add-in-tRPC-klienten (#83, ADR 0013-klienten lever
 * kvar, men git-peer-servern är pensionerad i #421/ADR 0016).
 *
 * Driver `createAddinClient` mot den RIKTIGA server-first-handlern
 * (`createServerTrpcHandler`) via en injicerad `fetch` → bevisar att add-in-
 * klienten är wire-kompatibel med servern: samma `/api/trpc`-endpoint,
 * superjson-transformer och `AppRouter`-yta. Detta är hela poängen med
 * "add-ins är tunna tRPC-klienter".
 *
 * Servern auktoriserar numera via oauth2-proxy forwarded headers
 * (`x-auth-request-email`, ADR 0016/0009) i st.f. Bearer-PAT. Den injicerade
 * fetch:en spelar oauth2-proxy:ns roll: en känd Bearer-token översätts till en
 * forwarded-identitet, en okänd token forwardas inte → principal=null → 401.
 */
import { describe, it, expect } from "vitest-compat";
import { createAddinClient, addinTrpcEndpoint, type AddinFetch } from "@/lib/client/addin/addin-client";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { OidcClaims } from "@/lib/server/auth/oidc-auth-provider";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { User } from "@/lib/shared/schemas/user";

const ORG = "org-1";
const USER: User = {
  id: "p-1", email: "advokat@byra.se", name: "Ada Advokat",
  role: "LAWYER", organizationId: ORG,
} as unknown as User;

/**
 * Minimal `repos`-stub: bara `users` används. `listByOrg` driver allowlisten
 * (principal-resolvern), medan `getByIdInOrg` ger `null` → `user.current` tar
 * den transienta vägen (`createdAt: new Date()`) som bevisar att superjson
 * round-trippar en `Date` över tråden.
 */
function reposStub(): Repositories {
  return {
    users: {
      listByOrg: async () => [USER],
      getByIdInOrg: async () => null,
    },
  } as unknown as Repositories;
}

/** Server-first-handler mot in-memory-principalen. */
function serverHandler(): (req: Request) => Promise<Response> {
  return createServerTrpcHandler({ repos: reposStub(), ports: noopPorts, organizationId: ORG });
}

/**
 * Add-in-klient som routar via en given server-handler (i st.f. nätet). Den
 * injicerade fetch:en spelar oauth2-proxy: känd Bearer → forwarded email-claim.
 */
function clientVia(handler: (req: Request) => Promise<Response>, token: string) {
  const tokenToClaims: Record<string, OidcClaims> = {
    "good-token": { email: USER.email, subject: "", issuer: "", name: USER.name },
  };
  const fetchImpl: AddinFetch = (input, init) => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    const auth = headers.get("authorization") ?? "";
    const claims = tokenToClaims[auth.replace(/^Bearer\s+/i, "")];
    if (claims) headers.set("x-auth-request-email", claims.email);
    headers.delete("authorization");
    return handler(new Request(input, { ...init, headers }));
  };
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
  it("giltig identitet → user.current returnerar principalen (end-to-end mot servern)", async () => {
    const client = clientVia(serverHandler(), "good-token");
    const me = await client.user.current.query();
    expect(me.email).toBe(USER.email);
    expect(me.name).toBe(USER.name);
    expect(me.createdAt).toBeInstanceOf(Date); // superjson round-trippade en Date
  });

  it("okänd identitet → UNAUTHORIZED → klienten kastar", async () => {
    const client = clientVia(serverHandler(), "wrong-token");
    await expect(client.user.current.query()).rejects.toThrow();
  });
});
