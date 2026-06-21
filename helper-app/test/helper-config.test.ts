/**
 * helper-config (ADR 0029) — config-fil för GUI-appar som inte ärver shell-env.
 */

import { describe, expect, test } from "bun:test";

import { envWithConfig, loadHelperConfig } from "../src/helper-config.ts";

function reader(map: Record<string, string>): (p: string) => string {
  return (p) => {
    const hit = Object.entries(map).find(([k]) => p.endsWith(k));
    if (!hit) throw new Error("ENOENT");
    return hit[1];
  };
}

describe("loadHelperConfig", () => {
  test("läser giltiga fält", () => {
    const cfg = loadHelperConfig("/dir", reader({ "helper-config.json": JSON.stringify({ oidcIssuer: "https://idp/realms/ava", oidcClientId: "ava-helper", redirectPort: 48765 }) }));
    expect(cfg).toEqual({ oidcIssuer: "https://idp/realms/ava", oidcClientId: "ava-helper", redirectPort: 48765 });
  });

  test("dir = null → tomt", () => {
    expect(loadHelperConfig(null)).toEqual({});
  });

  test("saknad fil → tomt", () => {
    expect(loadHelperConfig("/dir", () => { throw new Error("ENOENT"); })).toEqual({});
  });

  test("trasig JSON → tomt", () => {
    expect(loadHelperConfig("/dir", reader({ "helper-config.json": "{ trasig" }))).toEqual({});
  });

  test("ignorerar tomma/fel-typade fält", () => {
    const cfg = loadHelperConfig("/dir", reader({ "helper-config.json": JSON.stringify({ oidcIssuer: "  ", redirectPort: "nope", oidcClientId: "ava-helper" }) }));
    expect(cfg).toEqual({ oidcClientId: "ava-helper" });
  });
});

describe("envWithConfig", () => {
  test("env vinner över filen", () => {
    const merged = envWithConfig({ AVA_OIDC_ISSUER: "https://env" }, { oidcIssuer: "https://file", oidcClientId: "ava-helper" });
    expect(merged.AVA_OIDC_ISSUER).toBe("https://env");
    expect(merged.AVA_OIDC_CLIENT_ID).toBe("ava-helper"); // fyller där env saknas
  });

  test("filen fyller när env saknas (GUI-app utan shell-env)", () => {
    const merged = envWithConfig({}, { oidcIssuer: "https://file", redirectPort: 9000 });
    expect(merged.AVA_OIDC_ISSUER).toBe("https://file");
    expect(merged.AVA_HELPER_REDIRECT_PORT).toBe("9000");
  });

  test("varken env eller fil → undefined (login no-op:ar synligt)", () => {
    expect(envWithConfig({}, {}).AVA_OIDC_ISSUER).toBeUndefined();
  });
});
