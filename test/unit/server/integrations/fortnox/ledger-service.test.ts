import { describe, it, expect } from "vitest-compat";
import { FortnoxLedgerService, fortnoxLedgerFromEnv } from "@/lib/server/integrations/fortnox/ledger-service";
import { FORTNOX_REFRESH_TOKEN_TTL_MS, type FortnoxConfig, type FortnoxStoredTokens } from "@/lib/server/integrations/fortnox/schema";
import { VaultFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import type { SecretsVault } from "@/lib/server/secrets/vault";
import { DEFAULT_LEDGER_ACCOUNT_MAP } from "@/lib/shared/accounting/account-map";
import { buildSemanticVoucher } from "@/lib/shared/accounting/semantic-voucher";
import { requestUrl } from "@/lib/shared/request-url";

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
    const u = requestUrl(url);
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
    expect((await svc.status("org-1")).connected).toBe(false);
    const url = await svc.authorizeUrl("org-1");
    expect(url).toContain("client_id=cid");
    await svc.completeConnect("org-1", "code-1", stateOf(url));
    expect((await svc.status("org-1")).connected).toBe(true);
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
      if (requestUrl(url).endsWith("/oauth-v1/token")) return json(TOKENS);
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

  // #1885: ett fel med bilagan efter skapat verifikat kommer igenom låset som ett skäl, inte ett kast.
  it("attachmentError kommer igenom bokföringslåset", async () => {
    const fetchFn = ((url: string | URL | Request) => {
      const u = requestUrl(url);
      if (u.endsWith("/oauth-v1/token")) return Promise.resolve(json(TOKENS));
      if (u.endsWith("/3/vouchers")) return Promise.resolve(json({ Voucher: { VoucherSeries: "A", VoucherNumber: 4, Year: 1 } }));
      return Promise.resolve(new Response("bilagan nekad", { status: 400 }));
    }) as typeof globalThis.fetch;
    const svc = new FortnoxLedgerService(config, memVault(), fetchFn);
    await svc.completeConnect("org-1", "c", stateOf(await svc.authorizeUrl("org-1")));
    const push = svc.connector("org-1", DEFAULT_LEDGER_ACCOUNT_MAP).pushVoucher;
    if (!push) throw new Error("pushVoucher saknas");
    const voucher = buildSemanticVoucher({ amount: 100, vatOre: 0, vatBreakdown: null, invoiceDate: "2026-09-25", invoiceNumber: "F-3", matterNumber: null });
    const res = await push(voucher, { idempotencyKey: "c", attachment: { fileName: "F-3.pdf", bytes: new Uint8Array([1]) } });
    expect(res.externalId).toBe("A/4");
    expect(res.attachmentError).toEqual(expect.any(String));
  });
});

// ─── Anslutningens status och keepAlive (#1814) ──────────────────────

const NOW = 1_800_000_000_000;
const KEY = "fortnox.tokens.org-1";
const rejected = (): Response => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
const unavailable = (): Response => new Response("nere", { status: 503 });

/** Token-endpointen svarar med `token()`; API:t svarar med ett verifikat. Loggar varje anrop. */
function fortnoxFetch(token: () => Response, log: string[] = []): typeof globalThis.fetch {
  return (async (url: string | URL | Request) => {
    if (requestUrl(url).endsWith("/oauth-v1/token")) {
      log.push("token");
      await new Promise((r) => setTimeout(r, 5));
      return token();
    }
    log.push("api");
    return json({ Voucher: { VoucherSeries: "A", VoucherNumber: 1, Year: 1 } });
  }) as typeof globalThis.fetch;
}

/** Tjänst med en token-post i valvet (utgången access-token om inget annat sägs). */
async function connected(fetchFn: typeof globalThis.fetch, extra: Partial<FortnoxStoredTokens> = {}) {
  const vault = memVault();
  const store = new VaultFortnoxTokenStore(vault, KEY);
  await store.save({ accessToken: "gammal", refreshToken: "rt0", accessTokenExpiresAt: 0, ...extra });
  return { svc: new FortnoxLedgerService(config, vault, fetchFn, () => NOW), load: () => store.load() };
}

const VOUCHER = buildSemanticVoucher({ amount: 100, vatOre: 0, vatBreakdown: null, invoiceDate: "2026-09-25", invoiceNumber: "F-3", matterNumber: null });

describe("FortnoxLedgerService.status (#1814)", () => {
  it("inte ansluten: inget att förnya", async () => {
    const svc = new FortnoxLedgerService(config, memVault(), fortnoxFetch(() => json(TOKENS)));
    expect(await svc.status("org-1")).toEqual({ configured: true, connected: false, reconnectRequired: false, renewedAt: null, expiresAt: null });
  });

  it("ansluten med känd förnyelse: går ut 45 dygn efter den", async () => {
    const { svc } = await connected(fortnoxFetch(() => json(TOKENS)), { renewedAt: NOW });
    expect(await svc.status("org-1")).toEqual({
      configured: true, connected: true, reconnectRequired: false,
      renewedAt: new Date(NOW), expiresAt: new Date(NOW + FORTNOX_REFRESH_TOKEN_TTL_MS),
    });
  });

  it("ansluten utan känd förnyelse (äldre post): renewedAt och expiresAt är null", async () => {
    const { svc } = await connected(fortnoxFetch(() => json(TOKENS)));
    expect(await svc.status("org-1")).toEqual({ configured: true, connected: true, reconnectRequired: false, renewedAt: null, expiresAt: null });
  });

  it("markerad: inte ansluten, måste anslutas igen, ingen utgång", async () => {
    const { svc } = await connected(fortnoxFetch(() => json(TOKENS)), { renewedAt: NOW, reconnectRequiredAt: NOW });
    expect(await svc.status("org-1")).toEqual({ configured: true, connected: false, reconnectRequired: true, renewedAt: new Date(NOW), expiresAt: null });
  });
});

describe("FortnoxLedgerService.keepAlive (#1814)", () => {
  it("utan tokens: not-connected, inget nätanrop", async () => {
    const log: string[] = [];
    const svc = new FortnoxLedgerService(config, memVault(), fortnoxFetch(() => json(TOKENS), log));
    expect(await svc.keepAlive("org-1")).toBe("not-connected");
    expect(log).toEqual([]);
  });

  it("utgången access-token: förnyar, sparar ny renewedAt och svarar alive", async () => {
    const log: string[] = [];
    const { svc, load } = await connected(fortnoxFetch(() => json(TOKENS), log), { renewedAt: 1 });
    expect(await svc.keepAlive("org-1")).toBe("alive");
    expect(log).toEqual(["token", "api"]);
    const tokens = await load();
    expect(tokens?.refreshToken).toBe("rt");
    expect(tokens?.renewedAt ?? 0).toBeGreaterThan(1);
  });

  it("invalid_grant: reconnect-required och markering, utan kast", async () => {
    const { svc, load } = await connected(fortnoxFetch(rejected));
    expect(await svc.keepAlive("org-1")).toBe("reconnect-required");
    expect((await load())?.reconnectRequiredAt).toBe(NOW);
    expect((await svc.status("org-1")).reconnectRequired).toBe(true);
  });

  it("503: kastar utan markering, så att jobbkön kan försöka igen", async () => {
    const { svc, load } = await connected(fortnoxFetch(unavailable));
    await expect(svc.keepAlive("org-1")).rejects.toThrow(/503/);
    expect((await load())?.reconnectRequiredAt).toBeUndefined();
  });

  it("redan markerad: reconnect-required utan nätanrop", async () => {
    const log: string[] = [];
    const { svc } = await connected(fortnoxFetch(() => json(TOKENS), log), { reconnectRequiredAt: 5 });
    expect(await svc.keepAlive("org-1")).toBe("reconnect-required");
    expect(log).toEqual([]);
  });
});

describe("FortnoxLedgerService: bokning och anslutning med markeringen (#1814)", () => {
  it("pushVoucher med invalid_grant markerar och säger att den måste anslutas igen", async () => {
    const { svc, load } = await connected(fortnoxFetch(rejected));
    const push = svc.connector("org-1", DEFAULT_LEDGER_ACCOUNT_MAP).pushVoucher;
    if (!push) throw new Error("pushVoucher saknas");
    await expect(push(VOUCHER, { idempotencyKey: "x" })).rejects.toThrow(/måste anslutas igen/);
    expect((await load())?.reconnectRequiredAt).toBe(NOW);
  });

  it("pushVoucher med ett tillfälligt fel kastar det felet och markerar inte", async () => {
    const { svc, load } = await connected(fortnoxFetch(unavailable));
    const push = svc.connector("org-1", DEFAULT_LEDGER_ACCOUNT_MAP).pushVoucher;
    if (!push) throw new Error("pushVoucher saknas");
    await expect(push(VOUCHER, { idempotencyKey: "y" })).rejects.toThrow(/503/);
    expect((await load())?.reconnectRequiredAt).toBeUndefined();
  });

  it("completeConnect efter en markering: ansluten igen", async () => {
    const { svc } = await connected(fortnoxFetch(() => json(TOKENS)), { reconnectRequiredAt: 5 });
    await svc.completeConnect("org-1", "c", stateOf(await svc.authorizeUrl("org-1")));
    const status = await svc.status("org-1");
    expect([status.connected, status.reconnectRequired]).toEqual([true, false]);
  });

  it("keepAlive och pushVoucher samtidigt: en förnyelse, anropen i följd", async () => {
    const log: string[] = [];
    const { svc } = await connected(fortnoxFetch(() => json(TOKENS), log));
    const push = svc.connector("org-1", DEFAULT_LEDGER_ACCOUNT_MAP).pushVoucher;
    if (!push) throw new Error("pushVoucher saknas");
    const [alive, pushed] = await Promise.all([svc.keepAlive("org-1"), push(VOUCHER, { idempotencyKey: "z" })]);
    expect([alive, pushed.externalId]).toEqual(["alive", "A/1"]);
    expect(log).toEqual(["token", "api", "api"]);
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

  // #1886: bilagan kräver inbox (uppladdningen) och connectfile (kopplingen).
  it("begär bookkeeping, inbox och connectfile", async () => {
    const url = await fortnoxLedgerFromEnv(full)?.authorizeUrl("org-1");
    expect(url).toContain("scope=bookkeeping+inbox+connectfile");
  });
});
