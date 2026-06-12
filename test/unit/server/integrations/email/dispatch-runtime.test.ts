import { describe, it, expect } from "vitest-compat";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { buildDispatchJob, SMTP_VAULT_KEYS } from "@/lib/server/integrations/email/dispatch-runtime";
import { EncryptedFileVault, nodeVaultFs } from "@/lib/server/secrets/vault";

function vaultEnv(): { env: NodeJS.ProcessEnv; file: string; key: string } {
  const dir = mkdtempSync(join(tmpdir(), "smtp-vault-"));
  const file = join(dir, "vault.enc");
  const key = randomBytes(32).toString("base64");
  return { env: { AVA_SECRETS_KEY: key, AVA_SECRETS_FILE: file }, file, key };
}

describe("buildDispatchJob", () => {
  it("null när valvet inte är konfigurerat (inga env)", async () => {
    expect(await buildDispatchJob({ env: {}, log: () => {} })).toBeNull();
  });

  it("null när SMTP-uppgifter saknas i valvet", async () => {
    const { env } = vaultEnv();
    expect(await buildDispatchJob({ env, log: () => {} })).toBeNull();
  });

  it("returnerar ett PeerJob när SMTP-uppgifter finns i valvet", async () => {
    const { env, file, key } = vaultEnv();
    const vault = new EncryptedFileVault(file, Buffer.from(key, "base64"), nodeVaultFs());
    await vault.set(SMTP_VAULT_KEYS.host, "smtp.byra.se");
    await vault.set(SMTP_VAULT_KEYS.port, "587");
    await vault.set(SMTP_VAULT_KEYS.user, "noreply@byra.se");
    await vault.set(SMTP_VAULT_KEYS.pass, "hemligt");
    await vault.set(SMTP_VAULT_KEYS.from, "Byrå <noreply@byra.se>");

    const job = await buildDispatchJob({ env, log: () => {} });
    expect(job).not.toBeNull();
    expect(job!.message).toMatch(/dispatch/i);
    rmSync(join(file, ".."), { recursive: true, force: true });
  });
});
