/**
 * POST /config (ADR 0029) — web-appens auto-konfigurering av helpern.
 */

import { describe, expect, test } from "bun:test";

import { handleConfig, type ConfigDeps } from "../src/engine/config-endpoint.ts";
import { jsonRequest } from "./helpers.ts";

const saving: ConfigDeps = { save: (i) => ({ oidcIssuer: i.oidcIssuer }) };

describe("handleConfig", () => {
  test("kräver POST", async () => {
    expect((await handleConfig(new Request("http://h/config"), saving)).status).toBe(405);
  });

  test("kräver oidcIssuer", async () => {
    expect((await handleConfig(jsonRequest("/config", { oidcClientId: "x" }), saving)).status).toBe(400);
    expect((await handleConfig(jsonRequest("/config", { oidcIssuer: "   " }), saving)).status).toBe(400);
  });

  test("sparar + svarar configured", async () => {
    let savedInput: unknown;
    const res = await handleConfig(jsonRequest("/config", { oidcIssuer: "https://idp/realms/ava", oidcClientId: "ava-helper" }), {
      save: (i) => { savedInput = i; return { oidcIssuer: i.oidcIssuer }; },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "configured", oidcIssuer: "https://idp/realms/ava" });
    expect(savedInput).toMatchObject({ oidcClientId: "ava-helper" });
  });

  test("500 när save misslyckas (null)", async () => {
    const res = await handleConfig(jsonRequest("/config", { oidcIssuer: "https://idp" }), { save: () => null });
    expect(res.status).toBe(500);
  });
});
