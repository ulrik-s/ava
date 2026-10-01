/**
 * bearerClaims (ADR 0028 §1, ADR 0009) — verifiera IdP-JWT mot JWKS → OidcClaims.
 * Signerar tokens lokalt (jose) och verifierar mot en lokal JWKS, så testet är
 * IdP-oberoende och kräver ingen Keycloak.
 */

import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWTVerifyGetKey } from "jose";
import { describe, it, expect, beforeAll } from "vitest-compat";
import { bearerClaims, bearerConfigFromEnv, CLOCK_TOLERANCE_S, helperOidcConfig, verifyBearerToken } from "@/lib/server/http/bearer-claims";

const ISSUER = "https://idp.example/realms/ava";
const AUDIENCE = "ava";

let privateKey: CryptoKey;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const pub = await exportJWK(pair.publicKey);
  pub.kid = "test-key";
  pub.alg = "RS256";
  jwks = createLocalJWKSet({ keys: [pub] });
});

interface TokenOpts {
  issuer?: string;
  audience?: string;
  email?: string | undefined;
  name?: string;
  expiresIn?: string | number; // jose-format ("1h") eller epoch-sekunder
  signKey?: CryptoKey;
}

async function token(opts: TokenOpts = {}): Promise<string> {
  const claims: Record<string, unknown> = { sub: "user-123" };
  if (opts.email !== undefined) claims.email = opts.email;
  if (opts.name) claims.name = opts.name;
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt()
    .setIssuer(opts.issuer ?? ISSUER)
    .setAudience(opts.audience ?? AUDIENCE)
    .setExpirationTime(opts.expiresIn ?? "1h")
    .sign(opts.signKey ?? privateKey);
}

const nowS = (): number => Math.floor(Date.now() / 1000);

function authHeaders(jwt: string | null): Headers {
  const h = new Headers();
  if (jwt) h.set("authorization", `Bearer ${jwt}`);
  return h;
}

function cfg(): { issuer: string; audience: string; jwks: JWTVerifyGetKey } {
  return { issuer: ISSUER, audience: AUDIENCE, jwks };
}

describe("bearerClaims", () => {
  it("giltig token → OidcClaims (email/sub/iss/name)", async () => {
    const claims = await bearerClaims(authHeaders(await token({ email: "anna@firma.se", name: "Anna A" })), cfg());
    expect(claims).toEqual({ email: "anna@firma.se", subject: "user-123", issuer: ISSUER, name: "Anna A" });
  });

  it("ingen Authorization-header → null", async () => {
    expect(await bearerClaims(authHeaders(null), cfg())).toBeNull();
  });

  it("fel issuer → null", async () => {
    expect(await bearerClaims(authHeaders(await token({ issuer: "https://evil.example", email: "a@b.se" })), cfg())).toBeNull();
  });

  it("fel audience → null", async () => {
    expect(await bearerClaims(authHeaders(await token({ audience: "annan-app", email: "a@b.se" })), cfg())).toBeNull();
  });

  it("utgången token → null", async () => {
    const expired = await token({ email: "a@b.se", expiresIn: nowS() - CLOCK_TOLERANCE_S - 60 });
    expect(await bearerClaims(authHeaders(expired), cfg())).toBeNull();
  });

  it("fel signatur (annan nyckel) → null", async () => {
    const other = (await generateKeyPair("RS256")).privateKey;
    expect(await bearerClaims(authHeaders(await token({ email: "a@b.se", signKey: other })), cfg())).toBeNull();
  });

  it("saknad email-claim → null (email-only-modellen)", async () => {
    expect(await bearerClaims(authHeaders(await token({})), cfg())).toBeNull();
  });

  it("utan audience-konfig hoppas aud-kontrollen över", async () => {
    const claims = await bearerClaims(authHeaders(await token({ audience: "vad-som-helst", email: "a@b.se" })), { issuer: ISSUER, jwks });
    expect(claims?.email).toBe("a@b.se");
  });
});

describe("verifyBearerToken (#1351)", () => {
  it("skiljer saknad, utgången och ogiltig token åt", async () => {
    expect(await verifyBearerToken(null, cfg())).toEqual({ kind: "missing" });
    const expired = await token({ email: "a@b.se", expiresIn: nowS() - CLOCK_TOLERANCE_S - 60 });
    expect(await verifyBearerToken(`Bearer ${expired}`, cfg())).toEqual({ kind: "expired" });
    const forged = await token({ email: "a@b.se", signKey: (await generateKeyPair("RS256")).privateKey });
    expect(await verifyBearerToken(`Bearer ${forged}`, cfg())).toEqual({ kind: "invalid" });
    expect(await verifyBearerToken(`Bearer ${await token({})}`, cfg())).toEqual({ kind: "invalid" });
  });

  it("godtar en token som gått ut inom klocktoleransen", async () => {
    const justExpired = await token({ email: "a@b.se", expiresIn: nowS() - 10 });
    expect(await verifyBearerToken(`Bearer ${justExpired}`, cfg())).toMatchObject({ kind: "verified" });
  });

  it("godtar bara RS256 — en annan algoritm avvisas även med rätt nyckel", async () => {
    const es = await generateKeyPair("ES256");
    const jwt = await new SignJWT({ email: "a@b.se" })
      .setProtectedHeader({ alg: "ES256" }).setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime("1h")
      .sign(es.privateKey);
    const anyKey: JWTVerifyGetKey = async () => es.publicKey;
    expect(await verifyBearerToken(`Bearer ${jwt}`, { issuer: ISSUER, audience: AUDIENCE, jwks: anyKey })).toEqual({ kind: "invalid" });
  });
});

describe("bearerConfigFromEnv", () => {
  it("null utan AVA_OIDC_ISSUER", () => {
    expect(bearerConfigFromEnv({})).toBeNull();
  });

  it("config med issuer + audience", () => {
    const c = bearerConfigFromEnv({ AVA_OIDC_ISSUER: ISSUER, AVA_OIDC_AUDIENCE: AUDIENCE });
    expect(c?.issuer).toBe(ISSUER);
    expect(c?.audience).toBe(AUDIENCE);
    expect(c?.jwks).toBeTypeOf("function");
  });

  it("utan audience → ingen aud i config", () => {
    const c = bearerConfigFromEnv({ AVA_OIDC_ISSUER: ISSUER });
    expect(c?.audience).toBeUndefined();
  });
});

describe("helperOidcConfig (ADR 0029)", () => {
  it("null utan issuer (demo)", () => {
    expect(helperOidcConfig({})).toBeNull();
  });

  it("issuer + default clientId ava-helper", () => {
    expect(helperOidcConfig({ AVA_OIDC_ISSUER: ISSUER })).toEqual({ oidcIssuer: ISSUER, oidcClientId: "ava-helper" });
  });

  it("skickar med AVA_OIDC_SCOPE (Entra: byråns API-scope, #1149)", () => {
    expect(helperOidcConfig({ AVA_OIDC_ISSUER: ISSUER, AVA_OIDC_SCOPE: "api://x/access_as_user openid" }))
      .toEqual({ oidcIssuer: ISSUER, oidcClientId: "ava-helper", oidcScope: "api://x/access_as_user openid" });
  });

  it("respekterar AVA_OIDC_CLIENT_ID + AVA_OIDC_AUDIENCE", () => {
    expect(helperOidcConfig({ AVA_OIDC_ISSUER: ISSUER, AVA_OIDC_CLIENT_ID: "c", AVA_OIDC_AUDIENCE: "a" })).toEqual({ oidcIssuer: ISSUER, oidcClientId: "c", oidcAudience: "a" });
  });
});
