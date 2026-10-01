/**
 * Beskedet när OIDC-inloggningen nekas (#223, #1408).
 */
import { describe, expect, it } from "vitest-compat";
import { loginDeniedMessage } from "@/lib/client/auth/login-denied";

describe("loginDeniedMessage", () => {
  it("okänt konto: finns inte i byrån", () => {
    expect(loginDeniedMessage({ kind: "denied", email: "x@y.se" })).toMatch(/Inte behörig: ditt konto \(x@y\.se\) finns inte i byrån/);
  });

  it("tvetydig adress: hör till mer än ett konto — administratören rättar", () => {
    expect(loginDeniedMessage({ kind: "ambiguous", email: "x@y.se" })).toMatch(/hör till mer än ett konto.*administratören/);
  });
});
