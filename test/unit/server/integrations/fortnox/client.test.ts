import { describe, it, expect } from "vitest-compat";
import { FortnoxClient } from "@/lib/server/integrations/fortnox/client";
import type { FortnoxConfig, FortnoxStoredTokens, FortnoxVoucher } from "@/lib/server/integrations/fortnox/schema";
import { InMemoryFortnoxTokenStore } from "@/lib/server/integrations/fortnox/token-store";

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

describe("FortnoxClient fil-bilaga (#785)", () => {
  it("uploadInboxFile → POST /3/inbox (multipart) och returnerar fil-id", async () => {
    let url = ""; let auth = ""; let isForm = false;
    const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      auth = headers.Authorization ?? "";
      isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
      return new Response(JSON.stringify({ File: { Id: "guid-9" } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    const client = new FortnoxClient(config, new InMemoryFortnoxTokenStore(fresh()), fetchFn);

    const id = await client.uploadInboxFile("Faktura.pdf", new Uint8Array([1, 2, 3]));
    expect(id).toBe("guid-9");
    expect(url).toBe("https://api.test/3/inbox");
    expect(auth).toBe("Bearer at-fresh");
    expect(isForm).toBe(true);
  });

  it("connectFileToVoucher → POST /3/voucherfileconnections med FileId/serie/nummer", async () => {
    let url = ""; let body: unknown;
    const fetchFn = (async (u: string | URL | Request, init?: RequestInit) => {
      url = String(u);
      body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof globalThis.fetch;
    const client = new FortnoxClient(config, new InMemoryFortnoxTokenStore(fresh()), fetchFn);

    await client.connectFileToVoucher("guid-9", "A", "7");
    expect(url).toBe("https://api.test/3/voucherfileconnections");
    expect(body).toEqual({ VoucherFileConnection: { FileId: "guid-9", VoucherSeries: "A", VoucherNumber: "7" } });
  });
});

/**
 * Läs-vägen (#1030) — tillagd för att e2e:t ska kunna VERIFIERA att en push
 * landade, inte bara att skrivningen gav 200. Testerna vaktar två saker:
 * att GET-svarets rader överlever parsningen (POST-schemat strippar dem), och
 * att läs-vägen har samma token-livscykel som skriv-vägen.
 */
/**
 * Typad fetch-fake. `globalThis.fetch` bär `preconnect` i bun:s typer, så en
 * naken lambda matchar inte — och dubbel-cast är förbjuden (#562, ADR 0026).
 * `Object.assign` ger fakern den saknade egenskapen på riktigt i st.f. att
 * tysta typcheckaren.
 */
function fetchFake(handler: (url: string, init?: RequestInit) => Promise<Response>): typeof globalThis.fetch {
  const fn = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => handler(String(input), init);
  return Object.assign(fn, { preconnect: (): void => {} });
}

describe("FortnoxClient — läsa tillbaka (#1030)", () => {
  const FETCHED = {
    Voucher: {
      VoucherSeries: "A", VoucherNumber: 17, Year: 1,
      VoucherRows: [
        { Account: 1510, Debit: 125, Credit: 0 },
        { Account: 3041, Debit: 0, Credit: 100 },
        { Account: 2611, Debit: 0, Credit: 25 },
      ],
    },
  };

  it("getVoucher behåller raderna — annars går balansen inte att kontrollera", async () => {
    const store = new InMemoryFortnoxTokenStore({ accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: Date.now() + 3_600_000 });
    const client = new FortnoxClient(config, store, fetchFake(async () => json(200, FETCHED)));
    const res = await client.getVoucher("A", "17");
    expect(res.Voucher.VoucherRows).toHaveLength(3);
    const debit = res.Voucher.VoucherRows.reduce((s, r) => s + r.Debit, 0);
    const credit = res.Voucher.VoucherRows.reduce((s, r) => s + r.Credit, 0);
    expect(debit).toBe(credit);
  });

  it("getVoucher går mot rätt path och skickar Bearer", async () => {
    const store = new InMemoryFortnoxTokenStore({ accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: Date.now() + 3_600_000 });
    let seenUrl = ""; let seenAuth = "";
    const client = new FortnoxClient(config, store, fetchFake(async (url, init) => {
      seenUrl = url;
      seenAuth = ((init?.headers ?? {}) as Record<string, string>).Authorization ?? "";
      return json(200, FETCHED);
    }));
    await client.getVoucher("A", "17");
    expect(seenUrl).toBe("https://api.test/3/vouchers/A/17");
    expect(seenAuth).toBe("Bearer at");
  });

  it("getVoucher refreshar och gör om vid 401 — samma livscykel som skriv-vägen", async () => {
    const store = new InMemoryFortnoxTokenStore({ accessToken: "at-gammal", refreshToken: "rt", accessTokenExpiresAt: Date.now() + 3_600_000 });
    let calls = 0;
    const client = new FortnoxClient(config, store, fetchFake(async (url) => {
      if (url.endsWith("/oauth-v1/token")) return json(200, ROTATED);
      calls++;
      return calls === 1 ? json(401, { error: "expired" }) : json(200, FETCHED);
    }));
    const res = await client.getVoucher("A", "17");
    expect(res.Voucher.VoucherNumber).toBe(17);
    expect(calls).toBe(2);
    expect((await store.load())?.accessToken).toBe("at-new");
  });

  it("checkConnection slår mot voucherseries och skapar ingenting", async () => {
    const store = new InMemoryFortnoxTokenStore({ accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: Date.now() + 3_600_000 });
    const seen: Array<{ url: string; method: string }> = [];
    const client = new FortnoxClient(config, store, fetchFake(async (url, init) => {
      seen.push({ url, method: init?.method ?? "GET" });
      return json(200, { VoucherSeries: [] });
    }));
    await client.checkConnection();
    expect(seen).toEqual([{ url: "https://api.test/3/voucherseries", method: "GET" }]);
  });

  it("checkConnection kastar med statusen när anslutningen är död", async () => {
    const store = new InMemoryFortnoxTokenStore({ accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: Date.now() + 3_600_000 });
    const client = new FortnoxClient(config, store, fetchFake(async (url) =>
      url.endsWith("/oauth-v1/token") ? json(200, ROTATED) : json(403, { Message: "access-token saknas" })
    ));
    await expect(client.checkConnection()).rejects.toThrow(/403/);
  });
});

describe("FortnoxClient — verifikatserier (#1035)", () => {
  const SERIES = {
    VoucherSeriesCollection: [
      { Code: "A", Description: "Redovisning", Manual: true, Year: 1, NextVoucherNumber: 42 },
      { Code: "B", Description: "Kundfakturor", Manual: false, Year: 1 },
    ],
  };

  function storeWithFreshToken(): InMemoryFortnoxTokenStore {
    return new InMemoryFortnoxTokenStore({ accessToken: "at", refreshToken: "rt", accessTokenExpiresAt: Date.now() + 3_600_000 });
  }

  it("listVoucherSeries packar upp kollektionen", async () => {
    const client = new FortnoxClient(config, storeWithFreshToken(), fetchFake(async () => json(200, SERIES)));
    const series = await client.listVoucherSeries();
    expect(series.map((s) => s.Code)).toEqual(["A", "B"]);
  });

  // Manual-flaggan är hela poängen med listningen: en serie med Manual: false
  // (t.ex. B "Kundfakturor") avvisar manuella verifikat, och den som väljer
  // fel serie får ett 400 långt senare i stället för ett svar här.
  it("bär med Manual-flaggan", async () => {
    const client = new FortnoxClient(config, storeWithFreshToken(), fetchFake(async () => json(200, SERIES)));
    const series = await client.listVoucherSeries();
    expect(series.find((s) => s.Code === "A")?.Manual).toBe(true);
    expect(series.find((s) => s.Code === "B")?.Manual).toBe(false);
  });

  it("createVoucherSeries POST:ar Code + Description i Fortnox nästling", async () => {
    let seen: { url: string; method: string; body: unknown } | null = null;
    const client = new FortnoxClient(config, storeWithFreshToken(), fetchFake(async (url, init) => {
      seen = { url, method: init?.method ?? "GET", body: JSON.parse(String(init?.body)) };
      return json(200, { VoucherSeries: { Code: "Z", Description: "CI-testverifikat", Manual: true } });
    }));
    const created = await client.createVoucherSeries("Z", "CI-testverifikat");
    expect(created.Code).toBe("Z");
    expect(seen).toEqual({
      url: "https://api.test/3/voucherseries",
      method: "POST",
      body: { VoucherSeries: { Code: "Z", Description: "CI-testverifikat" } },
    });
  });

  it("okända fält i svaret fäller inte parsningen", async () => {
    const client = new FortnoxClient(config, storeWithFreshToken(), fetchFake(async () =>
      json(200, { VoucherSeries: { Code: "Z", Description: "CI", Manual: true, "@url": "https://api.test/3/voucherseries/Z" } })
    ));
    expect((await client.createVoucherSeries("Z", "CI")).Code).toBe("Z");
  });

  it("kastar med statusen när serien redan finns", async () => {
    const client = new FortnoxClient(config, storeWithFreshToken(), fetchFake(async (url) =>
      url.endsWith("/oauth-v1/token") ? json(200, ROTATED) : json(400, { ErrorInformation: { message: "Serien finns redan" } })
    ));
    await expect(client.createVoucherSeries("A", "dubblett")).rejects.toThrow(/400/);
  });
});
