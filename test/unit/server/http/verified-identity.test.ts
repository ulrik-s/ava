/**
 * Verifierad identitet (#1256): i `verified`-läget litar servern inte på
 * proxyns headers — bara på tokens den själv verifierat mot IdP:ns nycklar.
 */
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { users } from "@/lib/server/db/schema";
import { createServerContext } from "@/lib/server/http/server-context";
import { discoveredJwks, identityConfigFromEnv, IDENTITY_TOKEN_HEADER, parseAudience } from "@/lib/server/http/verified-identity";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ISSUER = "https://login.example/tenant/v2.0";
const PROXY_CLIENT = "oauth2-proxy-client";
const ORG = uuidv7();
const ANNA = uuidv7();

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwks: JWTVerifyGetKey;
let publicJwk: Record<string, unknown>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair("RS256")).privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256" };
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

function idToken(claims: Record<string, unknown>, opts: { audience?: string; key?: CryptoKey; exp?: number } = {}): Promise<string> {
  return new SignJWT({ sub: "s1", ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt().setIssuer(ISSUER).setAudience(opts.audience ?? PROXY_CLIENT).setExpirationTime(opts.exp ?? "1h")
    .sign(opts.key ?? privateKey);
}

describe("identityConfigFromEnv", () => {
  it("default är forwarded (oförändrat beteende)", () => {
    expect(identityConfigFromEnv({})).toEqual({ mode: "forwarded" });
    expect(identityConfigFromEnv({ AVA_IDENTITY: "forwarded" })).toEqual({ mode: "forwarded" });
  });

  it("verified med issuer + audience", () => {
    const cfg = identityConfigFromEnv({ AVA_IDENTITY: "verified", AVA_IDENTITY_ISSUER: ISSUER, AVA_IDENTITY_AUDIENCE: "a, b" });
    expect(cfg).toMatchObject({ mode: "verified", verify: { issuer: ISSUER, audience: ["a", "b"] } });
    const explicit = identityConfigFromEnv({ AVA_IDENTITY: "verified", AVA_IDENTITY_ISSUER: ISSUER, AVA_IDENTITY_AUDIENCE: "a", AVA_IDENTITY_JWKS_URI: "https://login.example/keys" });
    expect(explicit).toMatchObject({ mode: "verified", verify: { audience: "a" } });
  });

  it("felkonfiguration stoppar starten — hellre ingen server än en som tror att den verifierar", () => {
    expect(() => identityConfigFromEnv({ AVA_IDENTITY: "verified" })).toThrow(/kräver AVA_IDENTITY_ISSUER och AVA_IDENTITY_AUDIENCE/);
    expect(() => identityConfigFromEnv({ AVA_IDENTITY: "verified", AVA_IDENTITY_ISSUER: ISSUER })).toThrow(/AVA_IDENTITY_AUDIENCE/);
    expect(() => identityConfigFromEnv({ AVA_IDENTITY: "trust-me" })).toThrow(/"forwarded" eller "verified"/);
  });

  it("parseAudience: tom → ingen, en → sträng, flera → lista", () => {
    expect(parseAudience(undefined)).toBeUndefined();
    expect(parseAudience(" , ")).toBeUndefined();
    expect(parseAudience("x")).toBe("x");
    expect(parseAudience("x,y")).toEqual(["x", "y"]);
  });
});

describe("discoveredJwks", () => {
  it("hämtar jwks_uri ur OIDC-discovery en gång och verifierar mot den", async () => {
    const calls: string[] = [];
    const remotes: string[] = [];
    const getKey = discoveredJwks(`${ISSUER}/`, async (url) => {
      calls.push(url);
      return { ok: true, json: async () => ({ jwks_uri: "https://login.example/keys" }) };
    }, (uri) => { remotes.push(uri); return jwks; });
    const { jwtVerify } = await import("jose");
    await jwtVerify(await idToken({ email: "a@b.se" }), getKey, { issuer: ISSUER });
    await jwtVerify(await idToken({ email: "a@b.se" }), getKey, { issuer: ISSUER });
    expect(calls).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
    expect(remotes).toEqual(["https://login.example/keys"]);
  });

  it("standardvägarna: global fetch och fjärr-JWKS (bara konstruktion — ingen nätverkstrafik)", () => {
    expect(typeof discoveredJwks(ISSUER)).toBe("function");
  });

  it("discovery utan jwks_uri → fel, och nästa försök hämtar igen", async () => {
    let n = 0;
    const getKey = discoveredJwks(ISSUER, async () => { n++; return { ok: false, json: async () => ({}) }; });
    const { jwtVerify } = await import("jose");
    await expect(jwtVerify(await idToken({}), getKey)).rejects.toThrow(/saknar jwks_uri/);
    await expect(jwtVerify(await idToken({}), getKey)).rejects.toThrow(/saknar jwks_uri/);
    expect(n).toBe(2);
  });
});

describe("createServerContext i verified-läget (#1256)", () => {
  let handle: TestDbHandle;
  let repos: Repositories;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: ANNA, organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true, version: 1 } as any);
  });
  afterAll(async () => { await handle.close(); });

  const verified = () => ({
    repos, ports: noopPorts, organizationId: ORG,
    identity: { mode: "verified" as const, verify: { issuer: ISSUER, audience: PROXY_CLIENT, jwks } },
  });
  const req = (headers: Record<string, string>) => new Request("http://ava.test/api/trpc/user.current", { headers });

  it("en förfalskad X-Auth-Request-Email ignoreras — den som når porten direkt blir ingen", async () => {
    const ctx = await createServerContext(req({ "X-Auth-Request-Email": "anna@byra.se" }), verified());
    expect(ctx.user).toBeNull();
  });

  it("proxyns verifierade ID-token → principalen", async () => {
    const ctx = await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${await idToken({ email: "anna@byra.se" })}` }), verified());
    expect(ctx.user).toMatchObject({ id: ANNA, email: "anna@byra.se" });
  });

  it("Entras ID-token utan email-claim: UPN i preferred_username räcker", async () => {
    const ctx = await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${await idToken({ preferred_username: "anna@byra.se" })}` }), verified());
    expect(ctx.user).toMatchObject({ id: ANNA });
  });

  it("fel nyckel, eller token till en annan klient → ingen principal", async () => {
    const forged = await idToken({ email: "anna@byra.se" }, { key: otherKey });
    const forgedCtx = await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${forged}` }), verified());
    expect(forgedCtx.user).toBeNull();
    expect(forgedCtx.authFailure).toBe("no-identity");
    const otherClient = await idToken({ email: "anna@byra.se" }, { audience: "annan-app" });
    expect((await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${otherClient}` }), verified())).user).toBeNull();
  });

  it("utan proxyns token faller den tillbaka på klientens egen Bearer (helpern)", async () => {
    const helperDeps = { ...verified(), bearer: { issuer: ISSUER, audience: "helper", jwks } };
    const ctx = await createServerContext(req({ authorization: `Bearer ${await idToken({ email: "anna@byra.se" }, { audience: "helper" })}` }), helperDeps);
    expect(ctx.user).toMatchObject({ id: ANNA });
  });

  // #1351: utgången token skiljs från spärrat konto — klienten ber om ny inloggning.
  const expiredToken = () => idToken({ email: "anna@byra.se" }, { exp: Math.floor(Date.now() / 1000) - 3600 });

  it("proxyns token har gått ut → token-expired, inte spärrat konto", async () => {
    const ctx = await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${await expiredToken()}` }), verified());
    expect(ctx.user).toBeNull();
    expect(ctx.authFailure).toBe("token-expired");
  });

  it("utgången proxytoken men en giltig egen Bearer → principalen; utan egen → token-expired", async () => {
    const helperDeps = { ...verified(), bearer: { issuer: ISSUER, audience: "helper", jwks } };
    const own = `Bearer ${await idToken({ email: "anna@byra.se" }, { audience: "helper" })}`;
    const both = await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${await expiredToken()}`, authorization: own }), helperDeps);
    expect(both.user).toMatchObject({ id: ANNA });
    expect(both.authFailure).toBeUndefined();
    const alone = await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${await expiredToken()}` }), helperDeps);
    expect(alone.authFailure).toBe("token-expired");
  });

  it("giltig token för en okänd användare → account-inactive", async () => {
    const ctx = await createServerContext(req({ [IDENTITY_TOKEN_HEADER]: `Bearer ${await idToken({ email: "okand@byra.se" })}` }), verified());
    expect(ctx.authFailure).toBe("account-inactive");
  });
});
