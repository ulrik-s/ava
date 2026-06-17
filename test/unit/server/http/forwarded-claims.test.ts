/**
 * `forwardedClaims` (#410) — server-side OIDC-claims ur oauth2-proxy-headers.
 */

import { describe, it, expect } from "vitest-compat";
import {
  forwardedClaims,
  DEFAULT_FORWARDED_HEADER_NAMES,
} from "@/lib/server/http/forwarded-claims";

function h(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe("forwardedClaims", () => {
  it("läser email + display-namn ur preferred-username", () => {
    const claims = forwardedClaims(
      h({
        "X-Auth-Request-Email": "anna@byra.se",
        "X-Auth-Request-Preferred-Username": "Anna Jurist",
        "X-Auth-Request-User": "anna",
      }),
    );
    expect(claims).toEqual({ email: "anna@byra.se", subject: "", issuer: "", name: "Anna Jurist" });
  });

  it("faller tillbaka på user-headern när preferred-username saknas", () => {
    const claims = forwardedClaims(h({ "x-auth-request-email": "b@x.se", "x-auth-request-user": "b" }));
    expect(claims?.name).toBe("b");
  });

  it("ger tomt namn när varken preferred-username eller user finns", () => {
    expect(forwardedClaims(h({ "x-auth-request-email": "c@x.se" }))?.name).toBe("");
  });

  it("ger null utan email-header (ej inloggad / ej bakom proxy)", () => {
    expect(forwardedClaims(h({}))).toBeNull();
    expect(forwardedClaims(h({ "x-auth-request-email": "   " }))).toBeNull();
  });

  it("respekterar custom header-namn", () => {
    const claims = forwardedClaims(h({ "x-forwarded-email": "d@x.se" }), {
      ...DEFAULT_FORWARDED_HEADER_NAMES,
      email: "x-forwarded-email",
    });
    expect(claims?.email).toBe("d@x.se");
  });
});
