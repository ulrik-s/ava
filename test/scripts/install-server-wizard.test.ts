import { describe, it, expect } from "vitest-compat";
import {
  fieldsFor,
  answersToConfig,
  renderConfigTemplate,
  parseConfigFile,
  BASE_FIELDS,
  OIDC_FIELDS,
} from "../../tooling/scripts/install-server/wizard";

describe("fieldsFor", () => {
  it("htpasswd: bara grundfält", () => {
    expect(fieldsFor("htpasswd")).toEqual(BASE_FIELDS);
  });
  it("oidc: grund + oidc-fält", () => {
    expect(fieldsFor("oidc")).toEqual([...BASE_FIELDS, ...OIDC_FIELDS]);
  });
});

describe("answersToConfig", () => {
  it("htpasswd: mappar grundsvar, ingen oidc", () => {
    const cfg = answersToConfig({ repo: "r", "work-dir": "w", org: "o", auth: "htpasswd" }, "/v/vault.enc");
    expect(cfg).toEqual({ repoUrl: "r", workDir: "w", organizationId: "o", secretsFile: "/v/vault.enc", authMode: "htpasswd" });
  });
  it("oidc: inkluderar oidc-block", () => {
    const cfg = answersToConfig(
      { repo: "r", "work-dir": "w", org: "o", auth: "oidc", "oidc-issuer": "https://idp", "oidc-client-id": "ava", "oidc-client-secret": "s3cr3t", "oidc-redirect": "https://app/cb" },
      "/v/vault.enc",
    );
    expect(cfg.authMode).toBe("oidc");
    expect(cfg.oidc).toEqual({ issuerUrl: "https://idp", clientId: "ava", clientSecret: "s3cr3t", redirectUrl: "https://app/cb" });
  });
  it("okänt/utelämnat auth → htpasswd (säker default)", () => {
    expect(answersToConfig({ repo: "r" }, "/v").authMode).toBe("htpasswd");
    expect(answersToConfig({ auth: "skräp" }, "/v").authMode).toBe("htpasswd");
  });
});

describe("renderConfigTemplate", () => {
  it("ger giltig JSON med alla fält + _help", () => {
    const tpl = JSON.parse(renderConfigTemplate());
    expect(tpl.repo).toBe("");
    expect(tpl.auth).toBe("htpasswd"); // default
    expect(tpl["oidc-issuer"]).toBe("");
    expect(typeof tpl._help.repo).toBe("string");
  });
});

describe("parseConfigFile", () => {
  it("plockar strängvärden, hoppar _help + tomma", () => {
    const json = JSON.stringify({ _help: { repo: "x" }, repo: "r", org: "", auth: "oidc" });
    expect(parseConfigFile(json)).toEqual({ repo: "r", auth: "oidc" });
  });
  it("template → parse → answersToConfig (round-trip av ifylld mall)", () => {
    const tpl = JSON.parse(renderConfigTemplate());
    tpl.repo = "r"; tpl["work-dir"] = "w"; tpl.org = "o";
    const answers = parseConfigFile(JSON.stringify(tpl));
    expect(answersToConfig(answers, "/v").repoUrl).toBe("r");
  });
  it("icke-objekt → kastar", () => {
    expect(() => parseConfigFile("42")).toThrow(/JSON-objekt/);
  });
});
