import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest-compat";
import type { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import type { FortnoxJobCaller } from "@/lib/server/integrations/fortnox/invoice-job";
import { buildFortnoxJob, makeLoadConnector } from "@/lib/server/integrations/fortnox/runtime";
import { VaultFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import { createVaultFromEnv } from "@/lib/server/secrets/vault";
import { DEFAULT_LEDGER_ACCOUNT_MAP, type LedgerAccountMap } from "@/lib/shared/accounting/account-map";

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

/** Fake-caller vars org.getSettings ger angiven (eller ingen) ledger-map. */
function callerWithMap(map: LedgerAccountMap | null): FortnoxJobCaller {
  return {
    invoice: {
      list: async () => [],
      markFortnoxBooked: async () => ({}),
    },
    organization: {
      getSettings: async () => ({ ledgerAccountMap: map }),
    },
  };
}

// FortnoxLedgerConnector lagrar bara klienten; loadConnector anropar den inte.
const fakeClient = {} as unknown as FortnoxClient;

describe("makeLoadConnector", () => {
  it("deriverar connectorn ur byråns ledgerAccountMap (via callern)", async () => {
    const loadConnector = makeLoadConnector(fakeClient);
    const connector = await loadConnector(callerWithMap(DEFAULT_LEDGER_ACCOUNT_MAP));
    expect(connector).not.toBeNull();
    expect(connector?.capabilities().pushVoucher).toBe(true);
  });

  it("ingen ledgerAccountMap → null (completeness-gate)", async () => {
    const loadConnector = makeLoadConnector(fakeClient);
    expect(await loadConnector(callerWithMap(null))).toBeNull();
  });
});

describe("buildFortnoxJob", () => {
  it("valv ej konfigurerat (env saknas) → null", async () => {
    expect(await buildFortnoxJob({ env: {}, log: silent })).toBeNull();
  });

  it("valv men inga credentials → null", async () => {
    const job = await buildFortnoxJob({ env: vaultEnv(), log: silent });
    expect(job).toBeNull();
  });

  it("credentials men inga tokens (ej auktoriserad) → null", async () => {
    const env = vaultEnv();
    const vault = createVaultFromEnv(env);
    await vault.set("fortnox.client_id", "cid");
    await vault.set("fortnox.client_secret", "secret");

    const job = await buildFortnoxJob({ env, log: silent });
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

    const job = await buildFortnoxJob({ env, log: silent });
    expect(job).not.toBeNull();
    expect(job?.message).toMatch(/fortnox/i);
    expect(typeof job?.act).toBe("function");
  });
});
