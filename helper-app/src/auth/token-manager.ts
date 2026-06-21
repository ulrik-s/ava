/**
 * `TokenManager` (ADR 0028 §2) — ger en giltig access-token, förnyar autonomt.
 *
 * Helpern är browser-oberoende: när access-token:en är på väg att gå ut byter
 * den tyst sin refresh-token mot en ny utan användar-interaktion. Saknas
 * tokens (ej parad) eller går refresh fel → `null`, och anroparen faller
 * tillbaka (eller ber användaren para om). Klocka + refresh injiceras → testbart.
 */

import type { OidcEndpoints, TokenSet } from "./oidc.ts";
import { refreshTokens } from "./oidc.ts";
import type { TokenStore } from "./token-store.ts";

/** Förnya i god tid före utgång (klock-skew + nätlatens). */
const EXPIRY_SKEW_MS = 60_000;

export interface TokenManagerDeps {
  now: () => number;
  refresh: (ep: OidcEndpoints, p: { clientId: string; refreshToken: string }) => Promise<TokenSet>;
}

export class TokenManager {
  private readonly store: TokenStore;
  private readonly endpoints: OidcEndpoints;
  private readonly clientId: string;
  private readonly deps: TokenManagerDeps;

  constructor(store: TokenStore, endpoints: OidcEndpoints, clientId: string, deps?: Partial<TokenManagerDeps>) {
    this.store = store;
    this.endpoints = endpoints;
    this.clientId = clientId;
    this.deps = {
      now: deps?.now ?? Date.now,
      refresh: deps?.refresh ?? ((ep, p) => refreshTokens(ep, p)),
    };
  }

  /** En giltig access-token, eller `null` om ej parad / refresh misslyckades. */
  async getAccessToken(): Promise<string | null> {
    const tokens = await this.store.load();
    if (!tokens) return null;
    if (tokens.expiresAt - this.deps.now() > EXPIRY_SKEW_MS) return tokens.accessToken;
    if (!tokens.refreshToken) {
      await this.store.clear(); // utgången utan refresh → kräver om-parning
      return null;
    }
    try {
      const refreshed = await this.deps.refresh(this.endpoints, { clientId: this.clientId, refreshToken: tokens.refreshToken });
      await this.store.save(refreshed);
      return refreshed.accessToken;
    } catch {
      return null; // refresh nekad/utgången → om-parning krävs
    }
  }

  /** `Authorization: Bearer …`-headern, eller null. Bekvämlighet för fetch-deps. */
  async authHeader(): Promise<string | null> {
    const token = await this.getAccessToken();
    return token ? `Bearer ${token}` : null;
  }
}
