import { describe, it, expect } from "vitest-compat";
import { FortnoxLedgerService, fortnoxLedgerFromEnv } from "@/lib/server/integrations/fortnox/ledger-service";
import type { FortnoxConfig } from "@/lib/server/integrations/fortnox/schema";
import type { SecretsVault } from "@/lib/server/secrets/vault";
import { DEFAULT_LEDGER_ACCOUNT_MAP } from "@/lib/shared/accounting/account-map";
import { buildSemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";

const config: FortnoxConfig = {
  clientId: "cid", clientSecret: "secret", redirectUri: "https://app.example/settings/fortnox",
  scopes: ["bookkeeping"], authBase: "https://auth.test", apiBase: "https://api.test",
};

function memVault(): SecretsVault & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(k) { return map.get(k) ?? null; },
    async set(k, v) { map.set(k, v); },
    async delete(k) { map.delete(k); },
  };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

const TOKENS = { access_token: "at", refresh_token: "rt", token_type: "Bearer", expires_in: 3600 };

/** Token-endpoint + voucher-endpoint; varje voucher-POST får nästa nummer. */
function fakeFetch(log: string[]): typeof globalThis.fetch {
  let n = 0;
  return (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.endsWith("/oauth-v1/token")) { log.push("token"); return json(TOKENS); }
    n++;
    log.push(`voucher:${n}`);
    return json({ Voucher: { VoucherSeries: "A", VoucherNumber: n, Year: 1 } });
  }) as typeof globalThis.fetch;
}

const stateOf = (url: string): string => new URL(url).searchParams.get("state") ?? "";

describe("FortnoxLedgerService", () => {
  it("ej ansluten före consent, ansluten efter", async () => {
    const vault = memVault();
    const svc = new FortnoxLedgerService(config, vault, fakeFetch([]));
    expect(await svc.status("org-1")).toEqual({ configured: true, connected: false });
    const url = await svc.authorizeUrl("org-1");
    expect(url).toContain("client_id=cid");
    await svc.completeConnect("org-1", "code-1", stateOf(url));
    expect(await svc.status("org-1")).toEqual({ configured: true, connected: true });
    expect(vault.map.has("fortnox.tokens.org-1")).toBe(true);
  });

  it("okänd state avvisas (CSRF)", async () => {
    const svc = new FortnoxLedgerService(config, memVault(), fakeFetch([]));
    await expect(svc.completeConnect("org-1", "c", "fel")).rejects.toThrow(/gått ut eller är ogiltig/);
  });

  it("state från en annan org avvisas", async () => {
    const svc = new FortnoxLedgerService(config, memVault(), fakeFetch([]));
    const state = stateOf(await svc.authorizeUrl("org-1"));
    await expect(svc.completeConnect("org-2", "c", state)).rejects.toThrow(/ogiltig/);
  });

  it("utgången state avvisas och går inte att återanvända", async () => {
    let now = 0;
    const svc = new FortnoxLedgerService(config, memVault(), fakeFetch([]), () => now);
    const state = stateOf(await svc.authorizeUrl("org-1"));
    now = 11 * 60_000;
    await expect(svc.completeConnect("org-1", "c", state)).rejects.toThrow(/gått ut/);
    now = 0;
    await expect(svc.completeConnect("org-1", "c", state)).rejects.toThrow(/gått ut/);
  });

  it("connector pushar verifikat och serialiserar samtidiga anrop", async () => {
    const log: string[] = [];
    const svc = new FortnoxLedgerService(config, memVault(), fakeFetch(log));
    await svc.completeConnect("org-1", "c", stateOf(await svc.authorizeUrl("org-1")));
    const connector = svc.connector("org-1", DEFAULT_LEDGER_ACCOUNT_MAP);
    expect(connector.capabilities().pushVoucher).toBe(true);
    const voucher = buildSemanticVoucher({ amount: 12500, vatOre: 2500, vatBreakdown: null, invoiceDate: "2026-09-25", invoiceNumber: "F-1", matterNumber: "M-1" });
    const push = connector.pushVoucher;
    if (!push) throw new Error("pushVoucher saknas");
    const [a, b] = await Promise.all([push(voucher, { idempotencyKey: "1" }), push(voucher, { idempotencyKey: "2" })]);
    expect([a.externalId, b.externalId]).toEqual(["A/1", "A/2"]);
  });

  it("ett misslyckat anrop blockerar inte kön", async () => {
    let fail = true;
    const fetchFn = (async (url: string | URL | Request) => {
      if (String(url).endsWith("/oauth-v1/token")) return json(TOKENS);
      if (fail) { fail = false; return new Response("nej", { status: 400 }); }
      return json({ Voucher: { VoucherSeries: "A", VoucherNumber: 9, Year: 1 } });
    }) as typeof globalThis.fetch;
    const svc = new FortnoxLedgerService(config, memVault(), fetchFn);
    await svc.completeConnect("org-1", "c", stateOf(await svc.authorizeUrl("org-1")));
    const push = svc.connector("org-1", DEFAULT_LEDGER_ACCOUNT_MAP).pushVoucher;
    if (!push) throw new Error("pushVoucher saknas");
    const voucher = buildSemanticVoucher({ amount: 100, vatOre: 0, vatBreakdown: null, invoiceDate: "2026-09-25", invoiceNumber: "F-2", matterNumber: null });
    await expect(push(voucher, { idempotencyKey: "a" })).rejects.toThrow(/400/);
    expect((await push(voucher, { idempotencyKey: "b" })).externalId).toBe("A/9");
  });
});

describe("fortnoxLedgerFromEnv", () => {
  const full = {
    AVA_FORTNOX_CLIENT_ID: "cid", AVA_FORTNOX_CLIENT_SECRET: "s", AVA_FORTNOX_REDIRECT_URI: "https://x.test/settings/fortnox",
    AVA_SECRETS_KEY: Buffer.alloc(32, 1).toString("base64"), AVA_SECRETS_FILE: "/tmp/ava-test-vault.enc",
  };

  it("null när något saknas", () => {
    expect(fortnoxLedgerFromEnv({ ...full, AVA_SECRETS_KEY: undefined })).toBeNull();
    expect(fortnoxLedgerFromEnv({ ...full, AVA_FORTNOX_CLIENT_ID: "" })).toBeNull();
  });

  it("tjänst när allt finns (även service-konto)", () => {
    expect(fortnoxLedgerFromEnv(full)).toBeInstanceOf(FortnoxLedgerService);
    expect(fortnoxLedgerFromEnv({ ...full, AVA_FORTNOX_ACCOUNT_TYPE: "service" })).toBeInstanceOf(FortnoxLedgerService);
  });
});
