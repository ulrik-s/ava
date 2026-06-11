import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import {
  buildFortnoxJob,
  loadKontoMappning,
  KONTO_MAPPNING_PATH,
} from "@/lib/server/integrations/fortnox/runtime";
import { createVaultFromEnv } from "@/lib/server/secrets/vault";
import { VaultFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import type { FortnoxKontoMappning } from "@/lib/server/integrations/fortnox/schema";

const MAPPING: FortnoxKontoMappning = {
  voucherSeries: "A",
  kundfordran: "1510",
  intaktArvode: "3000",
  momsUtgaende: "2611",
};

let dir: string;
const silent = () => {};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "fortnox-rt-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Env med en färsk (tom) valv-fil i temp-katalogen. */
function vaultEnv(): NodeJS.ProcessEnv {
  return {
    AVA_SECRETS_KEY: randomBytes(32).toString("base64"),
    AVA_SECRETS_FILE: join(dir, "vault.enc"),
  } as NodeJS.ProcessEnv;
}

async function writeMapping(value: unknown): Promise<void> {
  await mkdir(join(dir, "settings"), { recursive: true });
  await writeFile(join(dir, KONTO_MAPPNING_PATH), JSON.stringify(value), "utf8");
}

describe("loadKontoMappning", () => {
  it("läser + strikt-parsar mappningen ur firma.git", async () => {
    await writeMapping(MAPPING);
    expect(await loadKontoMappning(dir)).toEqual(MAPPING);
  });

  it("saknad fil → null", async () => {
    expect(await loadKontoMappning(dir)).toBeNull();
  });

  it("ogiltig mappning → kastar (strikt parsning)", async () => {
    await writeMapping({ voucherSeries: "A" }); // saknar obligatoriska konton
    await expect(loadKontoMappning(dir)).rejects.toThrow();
  });
});

describe("buildFortnoxJob", () => {
  it("valv ej konfigurerat (env saknas) → null", async () => {
    expect(await buildFortnoxJob({ workDir: dir, env: {}, log: silent })).toBeNull();
  });

  it("valv men inga credentials → null", async () => {
    const job = await buildFortnoxJob({ workDir: dir, env: vaultEnv(), log: silent });
    expect(job).toBeNull();
  });

  it("credentials men inga tokens (ej auktoriserad) → null", async () => {
    const env = vaultEnv();
    const vault = createVaultFromEnv(env);
    await vault.set("fortnox.client_id", "cid");
    await vault.set("fortnox.client_secret", "secret");

    const job = await buildFortnoxJob({ workDir: dir, env, log: silent });
    expect(job).toBeNull();
  });

  it("fullt konfigurerat (creds + tokens) → returnerar ett PeerJob", async () => {
    const env = vaultEnv();
    const vault = createVaultFromEnv(env);
    await vault.set("fortnox.client_id", "cid");
    await vault.set("fortnox.client_secret", "secret");
    await new VaultFortnoxTokenStore(vault).save({
      accessToken: "at",
      refreshToken: "rt",
      accessTokenExpiresAt: Date.now() + 600_000,
    });

    const job = await buildFortnoxJob({ workDir: dir, env, log: silent });
    expect(job).not.toBeNull();
    expect(job?.message).toMatch(/fortnox/i);
    expect(typeof job?.act).toBe("function");
  });
});
