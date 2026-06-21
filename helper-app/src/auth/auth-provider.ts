/**
 * `buildAuthHeaderProvider` (ADR 0028 §2) — en `() => Promise<string|undefined>`
 * som ger helperns FÄRSKA `Authorization: Bearer …` mot AVA-servern, eller
 * `undefined` om helpern inte är parad / token gått ut utan refresh.
 *
 * Hot-path (giltig token i keychain) returnerar direkt UTAN nät/discovery, så
 * en nedladdning inte blockerar på IdP:n. Först när token håller på att gå ut
 * görs OIDC-discovery (cachad) + refresh via `TokenManager`. Wiras in i
 * helperns download/content/upload-kö så den autonomt bär sin egen Bearer.
 */

import { discoverOidc, type OidcEndpoints } from "./oidc.ts";
import { TokenManager } from "./token-manager.ts";
import { KeychainTokenStore, type TokenStore } from "./token-store.ts";

const EXPIRY_SKEW_MS = 60_000;

export interface AuthProviderDeps {
  now: () => number;
  discover: (issuer: string) => Promise<OidcEndpoints>;
  /** Bygg en manager för refresh-vägen (injicerbar för test). */
  makeManager: (store: TokenStore, ep: OidcEndpoints, clientId: string, now: () => number) => { authHeader: () => Promise<string | null> };
}

function defaultDeps(): AuthProviderDeps {
  return {
    now: Date.now,
    discover: (issuer) => discoverOidc(issuer),
    makeManager: (store, ep, clientId, now) => new TokenManager(store, ep, clientId, { now }),
  };
}

export function buildAuthHeaderProvider(
  config: { issuer: string; clientId: string },
  store: TokenStore = new KeychainTokenStore(),
  deps: AuthProviderDeps = defaultDeps(),
): () => Promise<string | undefined> {
  let endpointsP: Promise<OidcEndpoints> | undefined;
  return async () => {
    const tokens = await store.load();
    if (!tokens) return undefined;
    // Hot-path: giltig token → ingen discovery/nät.
    if (tokens.expiresAt - deps.now() > EXPIRY_SKEW_MS) return `Bearer ${tokens.accessToken}`;
    // Snart utgången → discover (cachad) + refresh via manager.
    try {
      const ep = await (endpointsP ??= deps.discover(config.issuer));
      const header = await deps.makeManager(store, ep, config.clientId, deps.now).authHeader();
      return header ?? undefined;
    } catch {
      return undefined;
    }
  };
}
