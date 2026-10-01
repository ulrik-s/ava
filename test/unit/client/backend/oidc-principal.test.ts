import { describe, it, expect } from "vitest-compat";
import { resolveSelfHostedPrincipal, classifyOidcLogin } from "@/lib/client/backend/oidc-principal";
import type { AllowlistedUser } from "@/lib/server/auth/oidc-auth-provider";

const USERS: AllowlistedUser[] = [
  { id: "u-1", email: "anna@byra.se", name: "Anna", role: "ADMIN", organizationId: "org-1" },
];

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

describe("classifyOidcLogin", () => {
  it("inga claims → no-session (icke-OIDC/ej inloggad)", () => {
    expect(classifyOidcLogin(null, USERS)).toEqual({ kind: "no-session" });
  });

  it("allowlistad email → authorized med principal", () => {
    const out = classifyOidcLogin({ email: "anna@byra.se", subject: "", issuer: "", name: "Anna" }, USERS);
    expect(out.kind).toBe("authorized");
    if (out.kind === "authorized") expect(out.principal.id).toBe("u-1");
  });

  it("autentiserad men ej allowlistad → denied med email", () => {
    const out = classifyOidcLogin({ email: "intrang@annan.se", subject: "", issuer: "", name: "" }, USERS);
    expect(out).toEqual({ kind: "denied", email: "intrang@annan.se" });
  });

  it("adressen hör till två konton → ambiguous (#1408), aldrig det första", () => {
    const twins = [...USERS, { ...USERS[0]!, id: "u-twin" }];
    const out = classifyOidcLogin({ email: USERS[0]!.email, subject: "", issuer: "", name: "" }, twins);
    expect(out).toEqual({ kind: "ambiguous", email: USERS[0]!.email });
  });
});
