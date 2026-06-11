import { describe, it, expect } from "vitest-compat";
import { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import { InMemoryFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";
import type { FortnoxConfig, FortnoxStoredTokens, FortnoxVoucher } from "@/lib/server/integrations/fortnox/schema";

const config: FortnoxConfig = {
  clientId: "cid",
  clientSecret: "secret",
  redirectUri: "https://app.example/cb",
  scopes: ["bookkeeping"],
  authBase: "https://auth.test",
  apiBase: "https://api.test",
};

const VOUCHER: FortnoxVoucher = {
  VoucherSeries: "A",
  TransactionDate: "2026-05-25",
  Description: "Faktura F-1",
  VoucherRows: [
    { Account: 1510, Debit: 125, Credit: 0 },
    { Account: 3041, Debit: 0, Credit: 100 },
    { Account: 2611, Debit: 0, Credit: 25 },
  ],
};

const VOUCHER_RESP = { Voucher: { VoucherSeries: "A", VoucherNumber: 17, Year: 1 } };
const ROTATED = { access_token: "at-new", refresh_token: "rt-new", token_type: "Bearer", expires_in: 3600 };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

interface Counts { token: number; voucher: number; lastAuth?: string; lastBody?: unknown }

/** fetch som routar token- vs voucher-endpoint; voucher-status styrs per anrop. */
function makeFetch(voucherStatuses: number[], counts: Counts) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/oauth-v1/token")) {
      counts.token++;
      return json(200, ROTATED);
    }
    counts.voucher++;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    counts.lastAuth = headers.Authorization ?? "";
    counts.lastBody = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const status = voucherStatuses[counts.voucher - 1] ?? 200;
    return status === 200 ? json(200, VOUCHER_RESP) : json(status, { error: "x" });
  }) as typeof globalThis.fetch;
}

function fresh(): FortnoxStoredTokens {
  return { accessToken: "at-fresh", refreshToken: "rt-1", accessTokenExpiresAt: Date.now() + 600_000 };
}
function expired(): FortnoxStoredTokens {
  return { accessToken: "at-old", refreshToken: "rt-1", accessTokenExpiresAt: Date.now() - 1 };
}

describe("FortnoxClient.createVoucher", () => {
  it("färsk token → POST verifikat med Bearer, ingen refresh", async () => {
    const counts: Counts = { token: 0, voucher: 0 };
    const store = new InMemoryFortnoxTokenStore(fresh());
    const client = new FortnoxClient(config, store, makeFetch([200], counts));

    const res = await client.createVoucher(VOUCHER);
    expect(res.Voucher.VoucherNumber).toBe(17);
    expect(counts.token).toBe(0);
    expect(counts.voucher).toBe(1);
    expect(counts.lastAuth).toBe("Bearer at-fresh");
  });

  it("POST-body: VoucherRows är en plain array (ej XML-nästlad VoucherRow)", async () => {
    // Regression: Fortnox JSON-API ger 400 \"Felaktig datastruktur\" om raderna
    // nästlas som { VoucherRow: [...] }. Verifierat mot sandbox 1838388.
    const counts: Counts = { token: 0, voucher: 0 };
    const client = new FortnoxClient(config, new InMemoryFortnoxTokenStore(fresh()), makeFetch([200], counts));

    await client.createVoucher(VOUCHER);
    const body = counts.lastBody as { Voucher: { VoucherRows: unknown } };
    expect(Array.isArray(body.Voucher.VoucherRows)).toBe(true);
    expect(body.Voucher.VoucherRows).toEqual(VOUCHER.VoucherRows);
  });

  it("utgången token → refreshar först och sparar den roterade token:en", async () => {
    const counts: Counts = { token: 0, voucher: 0 };
    const store = new InMemoryFortnoxTokenStore(expired());
    const client = new FortnoxClient(config, store, makeFetch([200], counts));

    await client.createVoucher(VOUCHER);
    expect(counts.token).toBe(1);
    expect(counts.lastAuth).toBe("Bearer at-new");
    const saved = await store.load();
    expect(saved?.accessToken).toBe("at-new");
    expect(saved?.refreshToken).toBe("rt-new"); // rotation persisterad
  });

  it("401 trots färsk token → forcerad refresh + omförsök", async () => {
    const counts: Counts = { token: 0, voucher: 0 };
    const store = new InMemoryFortnoxTokenStore(fresh());
    const client = new FortnoxClient(config, store, makeFetch([401, 200], counts));

    const res = await client.createVoucher(VOUCHER);
    expect(res.Voucher.VoucherNumber).toBe(17);
    expect(counts.token).toBe(1); // en refresh
    expect(counts.voucher).toBe(2); // ett omförsök
    expect(counts.lastAuth).toBe("Bearer at-new");
  });

  it("kastar om byrån inte auth:at (inga tokens)", async () => {
    const client = new FortnoxClient(config, new InMemoryFortnoxTokenStore(), makeFetch([200], { token: 0, voucher: 0 }));
    await expect(client.createVoucher(VOUCHER)).rejects.toThrow(/inga tokens/);
  });
});
