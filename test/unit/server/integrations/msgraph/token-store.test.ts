import { describe, it, expect } from "vitest-compat";
import type { MsStoredTokens } from "@/lib/server/integrations/msgraph/schema";
import { InMemoryGraphTokenStore, VaultGraphTokenStore } from "@/lib/server/integrations/msgraph/token-store";
import type { SecretsVault } from "@/lib/server/secrets/vault";

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

const tokens = (rt: string): MsStoredTokens => ({
  accessToken: "at",
  refreshToken: rt,
  accessTokenExpiresAt: 1_000,
});

describe("VaultGraphTokenStore", () => {
  it("save/load roundtrip via valvet", async () => {
    const store = new VaultGraphTokenStore(new MemVault());
    await store.save(tokens("rt-1"));
    expect((await store.load())?.refreshToken).toBe("rt-1");
  });

  // Rotationen ÄR skrivningen. Skrev save inte över hade nästa körning
  // autentiserat med en död token.
  it("save skriver över (rotation)", async () => {
    const store = new VaultGraphTokenStore(new MemVault());
    await store.save(tokens("rt-1"));
    await store.save(tokens("rt-2"));
    expect((await store.load())?.refreshToken).toBe("rt-2");
  });

  it("load → null när valvet är tomt", async () => {
    expect(await new VaultGraphTokenStore(new MemVault()).load()).toBeNull();
  });

  // Egen nyckel — annars hade Graph och Fortnox skrivit över varandra i samma valv.
  it("använder en egen valv-nyckel, skild från Fortnox", async () => {
    const vault = new MemVault();
    await new VaultGraphTokenStore(vault).save(tokens("rt-x"));
    expect(vault.m.has("msgraph.tokens")).toBe(true);
    expect(vault.m.has("fortnox.tokens")).toBe(false);
  });

  // En manipulerad eller trasig blob ska fälla vid LÄSNING, inte flöda vidare
  // som feltypad data och smälla någon annanstans.
  it("kastar på korrupt innehåll i valvet", async () => {
    const vault = new MemVault();
    await vault.set("msgraph.tokens", JSON.stringify({ accessToken: "at" }));
    await expect(new VaultGraphTokenStore(vault).load()).rejects.toThrow();
  });
});

describe("InMemoryGraphTokenStore", () => {
  it("börjar tom", async () => {
    expect(await new InMemoryGraphTokenStore().load()).toBeNull();
  });

  it("bär initiala tokens", async () => {
    expect((await new InMemoryGraphTokenStore(tokens("rt-0")).load())?.refreshToken).toBe("rt-0");
  });

  it("parsar strikt även internt", async () => {
    const store = new InMemoryGraphTokenStore();
    await expect(store.save({ accessToken: "", refreshToken: "r", accessTokenExpiresAt: 1 })).rejects.toThrow();
  });
});
