/**
 * `renderTrialRealm` (#337, ADR 0014 §4) — genererar en Keycloak-realm för
 * TRIAL-läget (bundlad, ephemeral IdP) ur install-parametrar, i st.f. den
 * statiska dev-realmen (`tooling/docker/keycloak/realm-ava.json`) med dess
 * hårdkodade testanvändare.
 *
 * Producerar EN confidential OIDC-klient (för oauth2-proxy) + EN admin-användare
 * (byråns login). Auktorisering görs av AVA:s allowlist i firma.git (ADR 0009),
 * så realmen behöver bara att användaren finns + kan autentisera. Importeras av
 * Keycloak via `start-dev --import-realm`.
 *
 * Modellerad på den fungerande realm-ava.json (scopes, audience-mapper,
 * webOrigins) så oauth2-proxy-token/-userinfo funkar likadant. PROD = BYO-IdP.
 */

export interface TrialRealmOpts {
  /** Realm-namn (= issuer-path-segmentet, t.ex. "ava" → /realms/ava). */
  realm: string;
  /** Byråns admin — blir login-användaren (email används som username). */
  adminEmail: string;
  adminPassword: string;
  /** oauth2-proxy-klienten. */
  clientId: string;
  clientSecret: string;
  /** Tillåtna redirect-URI:er (oauth2-proxy /oauth2/callback per origin). */
  redirectUris: string[];
}

interface KeycloakClient {
  clientId: string; name: string; enabled: true; protocol: "openid-connect";
  publicClient: false; secret: string; standardFlowEnabled: true;
  directAccessGrantsEnabled: false; redirectUris: string[]; webOrigins: string[];
  attributes: Record<string, string>; defaultClientScopes: string[];
  protocolMappers: Array<{ name: string; protocol: string; protocolMapper: string; config: Record<string, string> }>;
}
interface KeycloakUser {
  username: string; enabled: true; emailVerified: true; email: string;
  credentials: Array<{ type: "password"; value: string; temporary: false }>;
}
export interface KeycloakRealm {
  realm: string; enabled: true; sslRequired: "none"; registrationAllowed: false;
  loginWithEmailAllowed: true; duplicateEmailsAllowed: false; accessTokenLifespan: number;
  clients: KeycloakClient[]; users: KeycloakUser[];
}

function audienceMapper(clientId: string) {
  return {
    name: `audience-${clientId}`,
    protocol: "openid-connect",
    protocolMapper: "oidc-audience-mapper",
    config: { "included.client.audience": clientId, "id.token.claim": "true", "access.token.claim": "true" },
  };
}

export function renderTrialRealm(opts: TrialRealmOpts): KeycloakRealm {
  return {
    realm: opts.realm,
    enabled: true,
    // Trial: HTTP tillåtet (ephemeral, localhost). Prod-IdP terminerar TLS.
    sslRequired: "none",
    registrationAllowed: false,
    loginWithEmailAllowed: true,
    duplicateEmailsAllowed: false,
    accessTokenLifespan: 300,
    clients: [
      {
        clientId: opts.clientId,
        name: "AVA (OIDC)",
        enabled: true,
        protocol: "openid-connect",
        publicClient: false,
        secret: opts.clientSecret,
        standardFlowEnabled: true,
        // Bara browser-login via oauth2-proxy (standard flow) → ingen direct-access.
        directAccessGrantsEnabled: false,
        redirectUris: opts.redirectUris,
        webOrigins: ["+"],
        attributes: { "post.logout.redirect.uris": "+" },
        defaultClientScopes: ["openid", "email", "profile", "roles"],
        protocolMappers: [audienceMapper(opts.clientId)],
      },
    ],
    users: [
      {
        username: opts.adminEmail,
        enabled: true,
        emailVerified: true,
        email: opts.adminEmail,
        credentials: [{ type: "password", value: opts.adminPassword, temporary: false }],
      },
    ],
  };
}
