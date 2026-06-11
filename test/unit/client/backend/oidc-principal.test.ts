import { describe, it, expect } from "vitest-compat";
import {
  fetchOidcClaims,
  resolveSelfHostedPrincipal,
  OIDC_USERINFO_PATH,
} from "@/lib/client/backend/oidc-principal";
import type { AllowlistedUser } from "@/lib/server/auth/oidc-auth-provider";

function jsonRes(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const USERS: AllowlistedUser[] = [
  { id: "u-1", email: "anna@byra.se", name: "Anna", role: "ADMIN", organizationId: "org-1" },
];

describe("fetchOidcClaims", () => {
  it("hämtar email + namn ur userinfo", async () => {
    const fetchFn = (async (path: string | URL | Request) => {
      expect(String(path)).toBe(OIDC_USERINFO_PATH);
      return jsonRes(200, { email: "anna@byra.se", user: "anna", preferredUsername: "Anna A" });
    }) as unknown as typeof globalThis.fetch;

    const claims = await fetchOidcClaims(fetchFn);
    expect(claims).toEqual({ email: "anna@byra.se", subject: "", issuer: "", name: "Anna A" });
  });

  it("namn faller tillbaka på user när preferredUsername saknas", async () => {
    const fetchFn = (async () => jsonRes(200, { email: "x@y.se", user: "x" })) as unknown as typeof globalThis.fetch;
    const claims = await fetchOidcClaims(fetchFn);
    expect(claims?.name).toBe("x");
  });

  it("icke-ok svar (401/redirect) → null (ej inloggad)", async () => {
    const fetchFn = (async () => jsonRes(401, {})) as unknown as typeof globalThis.fetch;
    expect(await fetchOidcClaims(fetchFn)).toBeNull();
  });

  it("svar utan email → null", async () => {
    const fetchFn = (async () => jsonRes(200, { user: "x" })) as unknown as typeof globalThis.fetch;
    expect(await fetchOidcClaims(fetchFn)).toBeNull();
  });
});

describe("resolveSelfHostedPrincipal", () => {
  it("matchar email mot allowlisten → principal", () => {
    const p = resolveSelfHostedPrincipal(
      { email: "anna@byra.se", subject: "", issuer: "", name: "Anna" },
      USERS,
    );
    expect(p?.id).toBe("u-1");
    expect(p?.role).toBe("ADMIN");
  });

  it("null claims → null", () => {
    expect(resolveSelfHostedPrincipal(null, USERS)).toBeNull();
  });

  it("okänd email → null (ej allowlistad)", () => {
    const p = resolveSelfHostedPrincipal(
      { email: "okand@byra.se", subject: "", issuer: "", name: "" },
      USERS,
    );
    expect(p).toBeNull();
  });
});
