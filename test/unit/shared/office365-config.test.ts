/**
 * `entraAppConfig` (#1949) — Entra-appen tolkas på ett ställe, för webbappen,
 * servern och Outlook-tillägget.
 */
import { describe, expect, it } from "vitest-compat";
import { entraAppConfig } from "@/lib/shared/office365-config";

const ISSUER = "https://login.microsoftonline.com/tid-1/v2.0";

describe("entraAppConfig", () => {
  it("klient-id och tenanten ur en Entra-issuer", () => {
    expect(entraAppConfig({ clientId: "cid", issuer: ISSUER })).toEqual({ clientId: "cid", tenantId: "tid-1" });
  });

  it("en issuer som inte är Entra (Keycloak) → null", () => {
    expect(entraAppConfig({ clientId: "cid", issuer: "https://kc.example/realms/ava" })).toBeNull();
  });

  it("override av klient-id går före klient-id", () => {
    expect(entraAppConfig({ clientId: "cid", issuer: ISSUER, clientIdOverride: "addin" }))
      .toEqual({ clientId: "addin", tenantId: "tid-1" });
  });

  it("override av tenant går före issuern, också när issuern inte är Entra", () => {
    expect(entraAppConfig({ clientId: "cid", issuer: "https://kc.example", tenantIdOverride: "t2" }))
      .toEqual({ clientId: "cid", tenantId: "t2" });
  });

  it("saknade värden → null", () => {
    expect(entraAppConfig({})).toBeNull();
    expect(entraAppConfig({ issuer: ISSUER })).toBeNull();
    expect(entraAppConfig({ clientId: "cid" })).toBeNull();
    expect(entraAppConfig({ clientId: "", issuer: ISSUER })).toBeNull();
  });
});
