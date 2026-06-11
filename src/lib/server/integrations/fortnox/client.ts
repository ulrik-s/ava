/**
 * Fortnox API-klient (#82) — token-livscykel + Voucher API.
 *
 * Håller access-token färsk via refresh (och sparar den ROTERADE
 * refresh-token:en). Vid 401 trots "färsk" token görs en forcerad refresh +
 * ett omförsök. Allt nät via injicerad `fetch` (testbar utan Fortnox).
 */

import { refreshTokens, type FetchFn } from "./oauth";
import {
  fortnoxVoucherResponseSchema,
  type FortnoxConfig,
  type FortnoxVoucher,
  type FortnoxVoucherResponse,
} from "./schema";
import type { FortnoxTokenStore } from "./token-store";

/**
 * Wire-format för voucher-payloaden. Enligt Fortnox-dokumentationen nästlas
 * raderna som `VoucherRows: { VoucherRow: [...] }`. (Bekräfta exakt nesting
 * mot sandbox när creds finns — isolerat här så det är en enradsändring.)
 */
function toWireVoucher(v: FortnoxVoucher): Record<string, unknown> {
  return {
    VoucherSeries: v.VoucherSeries,
    TransactionDate: v.TransactionDate,
    Description: v.Description,
    ...(v.Comments ? { Comments: v.Comments } : {}),
    VoucherRows: { VoucherRow: v.VoucherRows },
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

  /** Skapa ett verifikat. Returnerar serie + nummer (för idempotens/spårning). */
  async createVoucher(voucher: FortnoxVoucher): Promise<FortnoxVoucherResponse> {
    const body = { Voucher: toWireVoucher(voucher) };
    let res = await this.apiPost("/3/vouchers", await this.accessToken(), body);
    if (res.status === 401) {
      res = await this.apiPost("/3/vouchers", await this.forceRefresh(), body);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Fortnox voucher-fel ${res.status}: ${detail.slice(0, 300)}`);
    }
    return fortnoxVoucherResponseSchema.parse(await res.json());
  }
}
