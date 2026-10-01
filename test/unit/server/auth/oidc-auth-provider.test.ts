import { describe, it, expect } from "vitest-compat";
import {
  OidcAuthProvider,
  resolveLogin,
  type AllowlistedUser,
  type OidcClaims,
} from "@/lib/server/auth/oidc-auth-provider";
import { arraySink, setLogSink, type LogRecord } from "@/lib/shared/observability/logger";

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

// #1408: adressen var inte unik — inloggningen tog första träffen. Nu nekas
// en tvetydig adress (fail closed): fel konto är värre än ingen inloggning.
describe("tvetydig e-post (#1408)", () => {
  const twins = [user(), user({ id: "u-2", email: " Anna@Byra.se ", organizationId: "org-2" })];

  it("adressen matchar två konton → ingen principal, och en varning med kontonas id:n (aldrig adressen)", () => {
    const records: LogRecord[] = [];
    const restore = setLogSink(arraySink(records));
    try {
      expect(new OidcAuthProvider(claims(), twins).getPrincipal()).toBeNull();
      expect(records).toContainEqual(expect.objectContaining({ event: "auth.ambiguous_login_email", count: 2, ids: ["u-1", "u-2"] }));
      expect(JSON.stringify(records)).not.toContain("anna@byra.se");
    } finally {
      setLogSink(restore);
    }
  });

  it("resolveLogin skiljer på tvetydig, nekad och behörig", () => {
    expect(resolveLogin(claims(), twins)).toEqual({ kind: "ambiguous", userIds: ["u-1", "u-2"] });
    expect(resolveLogin(claims({ email: "okand@byra.se" }), twins)).toEqual({ kind: "denied" });
    expect(resolveLogin(claims(), [user()])).toMatchObject({ kind: "authorized", principal: { id: "u-1" } });
  });
});
