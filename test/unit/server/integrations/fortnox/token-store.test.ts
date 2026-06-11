import { describe, it, expect } from "vitest-compat";
import { VaultFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import type { SecretsVault } from "@/lib/server/secrets/vault";
import type { FortnoxStoredTokens } from "@/lib/server/integrations/fortnox/schema";

class MemVault implements SecretsVault {
  readonly m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.m.set(k, v);
  }
  async delete(k: string) {
    this.m.delete(k);
  }
}

const tokens = (rt: string): FortnoxStoredTokens => ({
  accessToken: "at",
  refreshToken: rt,
  accessTokenExpiresAt: 1_000,
});

describe("VaultFortnoxTokenStore", () => {
  it("save/load roundtrip via valvet", async () => {
    const store = new VaultFortnoxTokenStore(new MemVault());
    await store.save(tokens("rt-1"));
    expect((await store.load())?.refreshToken).toBe("rt-1");
  });

  it("save skriver över (rotation)", async () => {
    const store = new VaultFortnoxTokenStore(new MemVault());
    await store.save(tokens("rt-1"));
    await store.save(tokens("rt-2"));
    expect((await store.load())?.refreshToken).toBe("rt-2");
  });

  it("load → null när valvet är tomt", async () => {
    expect(await new VaultFortnoxTokenStore(new MemVault()).load()).toBeNull();
  });

  it("använder den angivna valv-nyckeln", async () => {
    const vault = new MemVault();
    await new VaultFortnoxTokenStore(vault).save(tokens("rt-x"));
    expect(vault.m.has("fortnox.tokens")).toBe(true);
  });
});
