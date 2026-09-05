/**
 * Fortnox API-klient (#82) — token-livscykel + Voucher API.
 *
 * Håller access-token färsk via refresh (och sparar den ROTERADE
 * refresh-token:en). Vid 401 trots "färsk" token görs en forcerad refresh +
 * ett omförsök. Allt nät via injicerad `fetch` (testbar utan Fortnox).
 */

import { refreshTokens, type FetchFn } from "./oauth";
import {
  fortnoxFinancialYearListSchema,
  fortnoxInboxResponseSchema,
  fortnoxVoucherFetchSchema,
  fortnoxVoucherListSchema,
  fortnoxVoucherResponseSchema,
  fortnoxVoucherSeriesListSchema,
  fortnoxVoucherSeriesResponseSchema,
  type FortnoxConfig,
  type FortnoxVoucher,
  type FortnoxVoucherFetch,
  type FortnoxVoucherHead,
  type FortnoxVoucherResponse,
  type FortnoxVoucherSeries,
} from "./schema";
import type { FortnoxTokenStore } from "./token-store";

/**
 * Wire-format för voucher-payloaden. VERIFIERAT mot Fortnox sandbox (tenant
 * 1838388, 2026-06-11): JSON-API:t vill ha `VoucherRows` som en PLAIN ARRAY av
 * rad-objekt — INTE den XML-style-nästlingen `{ VoucherRow: [...] }` (den ger
 * `400 Felaktig datastruktur`, code 2002381). Account/Debit/Credit som tal är OK.
 */
function toWireVoucher(v: FortnoxVoucher): Record<string, unknown> {
  return {
    VoucherSeries: v.VoucherSeries,
    TransactionDate: v.TransactionDate,
    Description: v.Description,
    ...(v.Comments ? { Comments: v.Comments } : {}),
    VoucherRows: v.VoucherRows,
  };
}

export class FortnoxClient {
  constructor(
    private readonly config: FortnoxConfig,
    private readonly store: FortnoxTokenStore,
    private readonly fetchFn: FetchFn = globalThis.fetch,
  ) {}

  /** Giltig access-token: cachad om färsk, annars refresh + spara (rotation). */
  private async accessToken(nowMs: number = Date.now()): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens) throw new Error("Fortnox: inga tokens — kör OAuth-flödet (buildAuthorizeUrl) först.");
    if (nowMs < tokens.accessTokenExpiresAt) return tokens.accessToken;
    return this.refreshAndStore(tokens.refreshToken, nowMs);
  }

  /** Forcerad refresh (t.ex. efter 401). */
  private async forceRefresh(nowMs: number = Date.now()): Promise<string> {
    const tokens = await this.store.load();
    if (!tokens) throw new Error("Fortnox: inga tokens att förnya.");
    return this.refreshAndStore(tokens.refreshToken, nowMs);
  }

  private async refreshAndStore(refreshToken: string, nowMs: number): Promise<string> {
    const next = await refreshTokens(this.config, refreshToken, this.fetchFn, nowMs);
    await this.store.save(next);
    return next.accessToken;
  }

  private apiGet(path: string, token: string): Promise<Response> {
    return this.fetchFn(new URL(path, this.config.apiBase).toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
  }

  private apiPost(path: string, token: string, body: unknown): Promise<Response> {
    return this.fetchFn(new URL(path, this.config.apiBase).toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  /** POST med 401→forcerad-refresh-och-omförsök. `doPost` bygger requesten per token. */
  private async withRetry(doPost: (token: string) => Promise<Response>, what: string): Promise<Response> {
    let res = await doPost(await this.accessToken());
    if (res.status === 401) res = await doPost(await this.forceRefresh());
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Fortnox ${what} ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res;
  }

  /**
   * Hämta ett verifikat. Finns för att kunna VERIFIERA att en push landade
   * (e2e, #1030) — utan den vägen får man bara veta att Fortnox svarade 200 på
   * skrivningen, inte att verifikatet går att läsa tillbaka och balanserar.
   */
  async getVoucher(voucherSeries: string, voucherNumber: string): Promise<FortnoxVoucherFetch> {
    const res = await this.withRetry((t) => this.apiGet(`/3/vouchers/${voucherSeries}/${voucherNumber}`, t), "verifikat-hämtning");
    return fortnoxVoucherFetchSchema.parse(await res.json());
  }

  /**
   * Röktest av anslutningen: refreshar vid behov och slår mot en billig,
   * biverkningsfri endpoint. Skapar INGET — säker att köra före en skarp push.
   */
  async checkConnection(): Promise<void> {
    await this.withRetry((t) => this.apiGet("/3/voucherseries", t), "anslutningskoll");
  }

  /** Alla verifikatserier. `Manual` avgör om en serie tar manuella verifikat. */
  async listVoucherSeries(): Promise<FortnoxVoucherSeries[]> {
    const res = await this.withRetry((t) => this.apiGet("/3/voucherseries", t), "serielistning");
    return fortnoxVoucherSeriesListSchema.parse(await res.json()).VoucherSeriesCollection;
  }

  /**
   * Räkenskapsårets `Id` för ett datum-intervall (#1050). `financialyear`-
   * parametern vill ha Id:t, inte årtalet — slås upp här i st.f. att hårdkodas,
   * så CI inte går sönder tyst när byrån lägger upp ytterligare ett år.
   */
  async financialYearIdFor(fromDate: string, toDate: string): Promise<number> {
    const res = await this.withRetry((t) => this.apiGet("/3/financialyears", t), "räkenskapsårslistning");
    const years = fortnoxFinancialYearListSchema.parse(await res.json()).FinancialYears;
    const hit = years.find((y) => y.FromDate === fromDate && y.ToDate === toDate);
    if (!hit) {
      const known = years.map((y) => `${y.FromDate}..${y.ToDate}`).join(", ");
      throw new Error(`Inget räkenskapsår ${fromDate}..${toDate} i Fortnox. Fanns: ${known || "inga"}`);
    }
    return hit.Id;
  }

  /**
   * Alla verifikat i ett räkenskapsår — HUVUDEN, inte rader (`GET /3/vouchers`
   * levererar inga `VoucherRows`). Sidorna hämtas till `@TotalPages` är slut;
   * utan det hade delta-kollen tystnat så fort CI-året passerat en sidbredd,
   * och en tyst delta-koll är värre än ingen.
   */
  async listVouchers(financialYearId: number, pageSize = 100): Promise<FortnoxVoucherHead[]> {
    const all: FortnoxVoucherHead[] = [];
    for (let page = 1; ; page++) {
      const path = `/3/vouchers?financialyear=${financialYearId}&limit=${pageSize}&page=${page}`;
      const res = await this.withRetry((t) => this.apiGet(path, t), "verifikatlistning");
      const body = fortnoxVoucherListSchema.parse(await res.json());
      all.push(...body.Vouchers);
      if (page >= (body.MetaInformation?.["@TotalPages"] ?? 1)) return all;
    }
  }

  /**
   * Skapa en verifikatserie (#1035). Används för att lägga CI:s testverifikat i
   * en EGEN numrering: Fortnox saknar DELETE för verifikat, men i GUI:t går det
   * alltid att ta bort det sista verifikatet i en serie — vilket gör en egen
   * serie städbar bakifrån utan att röra byråns skarpa serier.
   */
  async createVoucherSeries(code: string, description: string): Promise<FortnoxVoucherSeries> {
    const body = { VoucherSeries: { Code: code, Description: description } };
    const res = await this.withRetry((t) => this.apiPost("/3/voucherseries", t, body), "serie-skapande");
    return fortnoxVoucherSeriesResponseSchema.parse(await res.json()).VoucherSeries;
  }

  /** Skapa ett verifikat. Returnerar serie + nummer (för idempotens/spårning). */
  async createVoucher(voucher: FortnoxVoucher): Promise<FortnoxVoucherResponse> {
    const body = { Voucher: toWireVoucher(voucher) };
    const res = await this.withRetry((t) => this.apiPost("/3/vouchers", t, body), "voucher-fel");
    return fortnoxVoucherResponseSchema.parse(await res.json());
  }

  /**
   * Ladda upp en fil (faktura-PDF) till Fortnox inbox → returnerar fil-id (#785).
   * Multipart/form-data: vi sätter INTE Content-Type själva så fetch lägger
   * boundary:n. Wire-detaljer (fältnamn "file", svarsnästling) bekräftas mot
   * sandbox; isolerat här för enkel justering.
   */
  async uploadInboxFile(fileName: string, bytes: Uint8Array, contentType?: string): Promise<string> {
    const url = new URL("/3/inbox", this.config.apiBase).toString();
    const type = contentType ?? "application/pdf";
    const doPost = (token: string): Promise<Response> => {
      const form = new FormData();
      // Uint8Array.from → färsk ArrayBuffer-backad vy (undviker SharedArrayBuffer-
      // ovissheten i BlobPart-typen utan cast).
      form.append("file", new Blob([Uint8Array.from(bytes)], { type }), fileName);
      return this.fetchFn(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, body: form });
    };
    const res = await this.withRetry(doPost, "fil-uppladdning");
    return fortnoxInboxResponseSchema.parse(await res.json()).File.Id;
  }

  /**
   * Koppla en uppladdad fil till ett verifikat (#785). Lagkrav: originalet
   * (fakturan) ska arkiveras tillsammans med verifikatet.
   */
  async connectFileToVoucher(fileId: string, voucherSeries: string, voucherNumber: string): Promise<void> {
    const body = { VoucherFileConnection: { FileId: fileId, VoucherSeries: voucherSeries, VoucherNumber: voucherNumber } };
    await this.withRetry((t) => this.apiPost("/3/voucherfileconnections", t, body), "fil-koppling");
  }
}
