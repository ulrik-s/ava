import { describe, it, expect } from "vitest-compat";
import {
  generateMasterKeyBase64,
  generateCookieSecret,
  vaultSecretsFor,
  renderServerEnv,
  planInstall,
  validateInstallConfig,
  VAULT_KEYS,
  type ServerInstallConfig,
} from "../../tooling/scripts/install-server/core";

const fixedRand = (size: number) => Buffer.alloc(size, 7);

const oidcCfg: ServerInstallConfig = {
  repoUrl: "https://git.byra.se/firma.git",
  workDir: "/srv/ava/wc",
  organizationId: "11111111-1111-5111-8111-111111111111",
  secretsFile: "/home/ava/.ava-secrets/vault.enc",
  authMode: "oidc",
  oidc: {
    issuerUrl: "https://idp/realms/byra",
    clientId: "ava",
    clientSecret: "s3cr3t",
    redirectUrl: "https://app/oauth2/callback",
  },
};

const htpasswdCfg: ServerInstallConfig = {
  repoUrl: "https://git.byra.se/firma.git",
  workDir: "/srv/ava/wc",
  organizationId: "org-1",
  secretsFile: "/home/ava/.ava-secrets/vault.enc",
  authMode: "htpasswd",
};

describe("generateMasterKeyBase64", () => {
  it("ger 32 byte base64 (44 tecken)", () => {
    const key = generateMasterKeyBase64(fixedRand);
    expect(Buffer.from(key, "base64").length).toBe(32);
    expect(key.length).toBe(44);
  });
});

describe("generateCookieSecret", () => {
  it("ger 32 byte base64url", () => {
    const s = generateCookieSecret(fixedRand);
    expect(Buffer.from(s, "base64url").length).toBe(32);
    expect(s).not.toMatch(/[+/=]/); // base64url
  });
});

describe("vaultSecretsFor", () => {
  it("OIDC: client_secret + cookie_secret i valvet", () => {
    expect(vaultSecretsFor(oidcCfg, "cookie123")).toEqual({
      [VAULT_KEYS.oidcClientSecret]: "s3cr3t",
      [VAULT_KEYS.oidcCookieSecret]: "cookie123",
    });
  });
  it("htpasswd: inga valv-secrets", () => {
    expect(vaultSecretsFor(htpasswdCfg, "cookie123")).toEqual({});
  });
});

describe("renderServerEnv", () => {
  it("innehåller icke-hemlig config men ALDRIG master-nyckel eller client-secret", () => {
    const env = renderServerEnv(oidcCfg);
    expect(env).toContain("AVA_SECRETS_FILE=/home/ava/.ava-secrets/vault.enc");
    expect(env).toContain("AVA_SR_REPO_URL=https://git.byra.se/firma.git");
    expect(env).toContain("OAUTH2_PROXY_CLIENT_ID=ava");
    expect(env).toContain("OIDC_ISSUER_URL=https://idp/realms/byra");
    // Hemligheter får ALDRIG hamna i .env (kommentar som nämner nyckeln är ok,
    // men ingen RIKTIG env-rad får sätta master-nyckeln).
    expect(env).not.toContain("s3cr3t");
    expect(env.split("\n").some((l) => /^AVA_SECRETS_KEY=/.test(l))).toBe(false);
  });
  it("htpasswd: utelämnar OIDC-rader", () => {
    const env = renderServerEnv(htpasswdCfg);
    expect(env).not.toContain("OAUTH2_PROXY_CLIENT_ID");
    expect(env).toContain("AVA_AUTH_MODE=htpasswd");
  });
});

describe("planInstall (idempotent)", () => {
  it("färsk install: generera nyckel + skapa valv", () => {
    expect(planInstall({ masterKeyExists: false, vaultExists: false }, oidcCfg)).toEqual({
      generateMasterKey: true,
      createVault: true,
      storeSecrets: true,
    });
  });
  it("re-run: behåller befintlig nyckel + valv (skriver ej över)", () => {
    expect(planInstall({ masterKeyExists: true, vaultExists: true }, oidcCfg)).toMatchObject({
      generateMasterKey: false,
      createVault: false,
    });
  });
  it("htpasswd: inga secrets att lagra", () => {
    expect(planInstall({ masterKeyExists: false, vaultExists: false }, htpasswdCfg).storeSecrets).toBe(false);
  });
});

describe("validateInstallConfig", () => {
  it("komplett OIDC-config → inga fel", () => {
    expect(validateInstallConfig(oidcCfg)).toEqual([]);
  });
  it("OIDC utan secret → fel", () => {
    const bad = { ...oidcCfg, oidc: { ...oidcCfg.oidc!, clientSecret: "" } };
    expect(validateInstallConfig(bad).join(" ")).toMatch(/OIDC/);
  });
  it("saknad repo/org → fel", () => {
    expect(validateInstallConfig({ ...htpasswdCfg, repoUrl: "", organizationId: "" }).length).toBeGreaterThanOrEqual(2);
  });
});
