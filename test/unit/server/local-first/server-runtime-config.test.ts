/**
 * Test för server-runtime D (#118) — config-parsing ur env.
 *
 * Verifierar: obligatoriska fält, defaults, tal-coercion och att alla fel
 * samlas i ett läsbart kast.
 */

import { describe, it, expect } from "vitest-compat";

import { loadRuntimeConfig } from "@/lib/server/local-first/server-runtime-config";

const MINIMAL: Record<string, string> = {
  AVA_SR_REPO_URL: "file:///srv/firma.git",
  AVA_SR_WORK_DIR: "/srv/wc",
  AVA_SR_ORG_ID: "org-1",
};

describe("loadRuntimeConfig (#118)", () => {
  it("parsar minimal env och fyller i defaults", () => {
    const cfg = loadRuntimeConfig(MINIMAL);
    expect(cfg.repoUrl).toBe("file:///srv/firma.git");
    expect(cfg.workDir).toBe("/srv/wc");
    expect(cfg.branch).toBe("main");
    expect(cfg.remote).toBe("origin");
    expect(cfg.pollIntervalMs).toBe(15_000);
    expect(cfg.maxRetries).toBe(3);
    expect(cfg.principal).toEqual({
      id: "server-runtime",
      email: "server-runtime@ava.local",
      name: "AVA Server-runtime",
      role: "ADMIN",
      organizationId: "org-1",
    });
  });

  it("respekterar override och coerce:ar tal-strängar", () => {
    const cfg = loadRuntimeConfig({
      ...MINIMAL,
      AVA_SR_BRANCH: "develop",
      AVA_SR_REMOTE: "upstream",
      AVA_SR_POLL_INTERVAL_MS: "5000",
      AVA_SR_MAX_RETRIES: "7",
      AVA_SR_PRINCIPAL_ID: "bot-1",
      AVA_SR_PRINCIPAL_EMAIL: "bot@firma.se",
      AVA_SR_PRINCIPAL_NAME: "Robot",
      AVA_SR_PRINCIPAL_ROLE: "LAWYER",
    });
    expect(cfg.branch).toBe("develop");
    expect(cfg.remote).toBe("upstream");
    expect(cfg.pollIntervalMs).toBe(5_000);
    expect(cfg.maxRetries).toBe(7);
    expect(cfg.principal.id).toBe("bot-1");
    expect(cfg.principal.role).toBe("LAWYER");
  });

  it("behandlar tom sträng som ej satt (default slår in)", () => {
    const cfg = loadRuntimeConfig({ ...MINIMAL, AVA_SR_BRANCH: "" });
    expect(cfg.branch).toBe("main");
  });

  it("kastar när repoUrl saknas (med fält i meddelandet)", () => {
    const { AVA_SR_REPO_URL: _omit, ...rest } = MINIMAL;
    expect(() => loadRuntimeConfig(rest)).toThrow(/repoUrl/);
  });

  it("kastar när organizationId saknas", () => {
    const { AVA_SR_ORG_ID: _omit, ...rest } = MINIMAL;
    expect(() => loadRuntimeConfig(rest)).toThrow(/organizationId/);
  });

  it("kastar på ogiltigt intervall (negativt / icke-numeriskt)", () => {
    expect(() => loadRuntimeConfig({ ...MINIMAL, AVA_SR_POLL_INTERVAL_MS: "-1" })).toThrow(/pollIntervalMs/);
    expect(() => loadRuntimeConfig({ ...MINIMAL, AVA_SR_MAX_RETRIES: "abc" })).toThrow(/maxRetries/);
  });

  it("samlar flera fel i ett kast", () => {
    expect(() => loadRuntimeConfig({})).toThrow(/repoUrl[\s\S]*workDir|workDir[\s\S]*repoUrl/);
  });
});
