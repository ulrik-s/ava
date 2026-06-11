import { describe, it, expect } from "vitest-compat";
import {
  OidcAuthProvider,
  type AllowlistedUser,
  type OidcClaims,
} from "@/lib/server/auth/oidc-auth-provider";

const ORG = "org-1";

function user(over: Partial<AllowlistedUser> = {}): AllowlistedUser {
  return {
    id: "u-1",
    email: "anna@byra.se",
    name: "Anna Advokat",
    role: "LAWYER",
    organizationId: ORG,
    ...over,
  };
}

function claims(over: Partial<OidcClaims> = {}): OidcClaims {
  return { email: "anna@byra.se", subject: "sub-123", issuer: "https://idp.example", ...over };
}

describe("OidcAuthProvider.getPrincipal", () => {
  it("inga claims → null (anonym)", () => {
    expect(new OidcAuthProvider(null, [user()]).getPrincipal()).toBeNull();
  });

  it("tom email i claims → null", () => {
    expect(new OidcAuthProvider(claims({ email: "" }), [user()]).getPrincipal()).toBeNull();
  });

  it("email ej i allowlisten → null (neka okänd)", () => {
    const p = new OidcAuthProvider(claims({ email: "okand@byra.se" }), [user()]).getPrincipal();
    expect(p).toBeNull();
  });

  it("obunden allowlist-rad → principal (första login, matchar via email)", () => {
    const p = new OidcAuthProvider(claims(), [user()]).getPrincipal();
    expect(p).toEqual({
      id: "u-1",
      email: "anna@byra.se",
      name: "Anna Advokat",
      role: "LAWYER",
      organizationId: ORG,
    });
  });

  it("email-matchning är skiftlägesokänslig + trimmad", () => {
    const p = new OidcAuthProvider(claims({ email: "  ANNA@Byra.SE " }), [user()]).getPrincipal();
    expect(p?.id).toBe("u-1");
  });

  it("bunden rad med matchande sub+iss → principal", () => {
    const u = user({ oidcSubject: "sub-123", oidcIssuer: "https://idp.example" });
    expect(new OidcAuthProvider(claims(), [u]).getPrincipal()?.id).toBe("u-1");
  });

  it("bunden rad med fel sub → null (kapningsskydd)", () => {
    const u = user({ oidcSubject: "sub-OTHER", oidcIssuer: "https://idp.example" });
    expect(new OidcAuthProvider(claims(), [u]).getPrincipal()).toBeNull();
  });

  it("bunden rad med fel iss → null", () => {
    const u = user({ oidcSubject: "sub-123", oidcIssuer: "https://annan-idp" });
    expect(new OidcAuthProvider(claims(), [u]).getPrincipal()).toBeNull();
  });

  it("inaktiverad användare → null (avprovisionerad)", () => {
    expect(new OidcAuthProvider(claims(), [user({ active: false })]).getPrincipal()).toBeNull();
  });

  it("aktiv === true respekteras", () => {
    expect(new OidcAuthProvider(claims(), [user({ active: true })]).getPrincipal()?.id).toBe("u-1");
  });

  it("namn-fallback: tomt user.name → claims.name → email", () => {
    const a = new OidcAuthProvider(claims({ name: "Claims Namn" }), [user({ name: "" })]).getPrincipal();
    expect(a?.name).toBe("Claims Namn");
    // claims() utan name → fallback hela vägen till email
    const b = new OidcAuthProvider(claims(), [user({ name: "" })]).getPrincipal();
    expect(b?.name).toBe("anna@byra.se");
  });

  it("roll + org förs vidare oförändrade", () => {
    const u = user({ role: "ADMIN", organizationId: "org-X" });
    const p = new OidcAuthProvider(claims(), [u]).getPrincipal();
    expect(p?.role).toBe("ADMIN");
    expect(p?.organizationId).toBe("org-X");
  });

  it("väljer rätt rad ur en allowlist med flera", () => {
    const users = [user({ id: "u-1", email: "anna@byra.se" }), user({ id: "u-2", email: "bo@byra.se" })];
    const p = new OidcAuthProvider(claims({ email: "bo@byra.se" }), users).getPrincipal();
    expect(p?.id).toBe("u-2");
  });
});
