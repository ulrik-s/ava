/**
 * `runLogin` (ADR 0028 §2) — paras helpern mot byråns IdP via loopback-PKCE
 * (RFC 8252): discover → PKCE → starta callback-server → öppna browsern →
 * fånga koden → byt mot tokens → spara i keychain. Engångsflöde (CLI `--login`);
 * därefter förnyar `TokenManager` autonomt.
 *
 * Allt IO injiceras (`LoginDeps`) → hela orkestreringen är testbar utan riktig
 * browser/IdP. `loginConfigFromEnv` läser issuer/clientId/redirect-port.
 */

import { log } from "../log.ts";
import { openUrlInBrowser } from "../platform/open-app.ts";
import { waitForCallback } from "./callback-server.ts";
import { buildAuthorizeUrl, discoverOidc, exchangeCode, type OidcEndpoints, type TokenSet } from "./oidc.ts";
import { generatePkce, randomState, type Pkce } from "./pkce.ts";
import { KeychainTokenStore, type TokenStore } from "./token-store.ts";

export interface LoginConfig {
  issuer: string;
  clientId: string;
  redirectPort: number;
  scope?: string;
}

const DEFAULT_CLIENT_ID = "ava-helper";
const DEFAULT_REDIRECT_PORT = 48765;

function parseRedirectPort(raw: string | undefined): number {
  const p = Number(raw);
  return Number.isInteger(p) && p > 0 ? p : DEFAULT_REDIRECT_PORT;
}

/** Läs login-config ur miljön; null om `AVA_OIDC_ISSUER` saknas (auth av). */
export function loginConfigFromEnv(env: Record<string, string | undefined> = process.env): LoginConfig | null {
  const issuer = env.AVA_OIDC_ISSUER?.trim();
  if (!issuer) return null;
  const scope = env.AVA_OIDC_SCOPE?.trim();
  return {
    issuer,
    clientId: env.AVA_OIDC_CLIENT_ID?.trim() || DEFAULT_CLIENT_ID,
    redirectPort: parseRedirectPort(env.AVA_HELPER_REDIRECT_PORT),
    ...(scope ? { scope } : {}),
  };
}

export interface LoginDeps {
  discover: (issuer: string) => Promise<OidcEndpoints>;
  makePkce: () => Pkce;
  makeState: () => string;
  openUrl: (url: string) => Promise<void>;
  awaitCallback: (port: number, expectedState: string) => Promise<string>;
  exchange: (ep: OidcEndpoints, p: { clientId: string; code: string; verifier: string; redirectUri: string }) => Promise<TokenSet>;
  store: TokenStore;
}

export function defaultLoginDeps(): LoginDeps {
  return {
    discover: (issuer) => discoverOidc(issuer),
    makePkce: () => generatePkce(),
    makeState: () => randomState(),
    openUrl: (url) => openUrlInBrowser(url),
    awaitCallback: (port, state) => waitForCallback(port, state),
    exchange: (ep, p) => exchangeCode(ep, p),
    store: new KeychainTokenStore(),
  };
}

/**
 * Kör hela paringsflödet. Startar callback-servern FÖRE browsern (annars kan
 * redirecten komma innan vi lyssnar). Returnerar true vid lyckad paring.
 */
export async function runLogin(config: LoginConfig, deps: LoginDeps = defaultLoginDeps()): Promise<boolean> {
  const ep = await deps.discover(config.issuer);
  const pkce = deps.makePkce();
  const state = deps.makeState();
  const redirectUri = `http://127.0.0.1:${config.redirectPort}/callback`;

  const callback = deps.awaitCallback(config.redirectPort, state); // lyssna först
  const authUrl = buildAuthorizeUrl(ep, {
    clientId: config.clientId,
    redirectUri,
    challenge: pkce.challenge,
    state,
    ...(config.scope ? { scope: config.scope } : {}),
  });
  log(`auth: öppnar browsern för inloggning (${config.issuer})`);
  await deps.openUrl(authUrl);

  const code = await callback;
  const tokens = await deps.exchange(ep, { clientId: config.clientId, code, verifier: pkce.verifier, redirectUri });
  await deps.store.save(tokens);
  log("auth: paring klar — tokens sparade i keychain");
  return true;
}
