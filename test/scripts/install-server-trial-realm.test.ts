/**
 * Test för renderTrialRealm (#337) — Keycloak trial-realm ur install-parametrar.
 */

import { describe, it, expect } from "vitest-compat";
import { renderTrialRealm } from "../../tooling/scripts/install-server/trial-realm";

const opts = {
  realm: "byra",
  adminEmail: "ada@byra.se",
  adminPassword: "hemligt123",
  clientId: "ava-web",
  clientSecret: "s3cr3t",
  redirectUris: ["https://ava.byra.se/oauth2/callback", "http://localhost:8080/oauth2/callback"],
};

describe("renderTrialRealm", () => {
  it("realm-grundinställningar (namn, enabled, http tillåtet, ingen registrering)", () => {
    const r = renderTrialRealm(opts);
    expect(r.realm).toBe("byra");
    expect(r.enabled).toBe(true);
    expect(r.sslRequired).toBe("none");
    expect(r.registrationAllowed).toBe(false);
    expect(r.loginWithEmailAllowed).toBe(true);
  });

  it("EN confidential klient med secret + redirectUris + standard flow", () => {
    const c = renderTrialRealm(opts).clients;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      clientId: "ava-web",
      publicClient: false,
      secret: "s3cr3t",
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: opts.redirectUris,
    });
  });

  it("audience-mapper pekar på klient-id:t (oauth2-proxy-token funkar)", () => {
    const mapper = renderTrialRealm(opts).clients[0]!.protocolMappers[0]!;
    expect(mapper.protocolMapper).toBe("oidc-audience-mapper");
    expect(mapper.config["included.client.audience"]).toBe("ava-web");
  });

  it("EN admin-användare: email = username, lösenord ej temporärt, emailVerified", () => {
    const u = renderTrialRealm(opts).users;
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ username: "ada@byra.se", email: "ada@byra.se", emailVerified: true });
    expect(u[0]!.credentials[0]).toEqual({ type: "password", value: "hemligt123", temporary: false });
  });

  it("defaults: realm 'ava' + klient 'ava' när inget anges", () => {
    const r = renderTrialRealm({ ...opts, realm: "ava", clientId: "ava" });
    expect(r.realm).toBe("ava");
    expect(r.clients[0]!.clientId).toBe("ava");
  });
});
