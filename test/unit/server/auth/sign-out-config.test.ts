/**
 * IdP:ns utloggning (#1347): `AVA_OIDC_END_SESSION_URL` → `system.signOutConfig`.
 * Bara en http(s)-URL godtas; annars null (bara proxyns cookie tas bort).
 */
import { afterEach, describe, expect, it } from "vitest-compat";
import { buildGitPorts } from "@/lib/server/adapters/git-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import { signOutConfig, signOutConfigSchema } from "@/lib/server/auth/sign-out-config";
import { buildContext } from "@/lib/server/build-context";
import { DemoDataStore } from "@/lib/server/data-store/DemoDataStore";
import { appRouter } from "@/lib/server/routers/_app";

const ENTRA = "https://login.microsoftonline.com/tenant/oauth2/v2.0/logout?post_logout_redirect_uri=https%3A%2F%2Fava.byra.se%2Flogin%2F%3FsignedOut%3D1";

describe("signOutConfig", () => {
  it("en konfigurerad IdP-utloggning", () => {
    expect(signOutConfig({ AVA_OIDC_END_SESSION_URL: ` ${ENTRA} ` })).toEqual({ endSessionUrl: ENTRA });
    expect(signOutConfig({ AVA_OIDC_END_SESSION_URL: "http://localhost:8089/realms/ava/protocol/openid-connect/logout" }).endSessionUrl)
      .toMatch(/^http:\/\/localhost:8089/);
  });

  it("saknas, tom eller inte en http(s)-URL → null", () => {
    expect(signOutConfig({})).toEqual({ endSessionUrl: null });
    expect(signOutConfig({ AVA_OIDC_END_SESSION_URL: "" })).toEqual({ endSessionUrl: null });
    expect(signOutConfig({ AVA_OIDC_END_SESSION_URL: "javascript:alert(1)" })).toEqual({ endSessionUrl: null });
    expect(signOutConfig({ AVA_OIDC_END_SESSION_URL: "inte en url" })).toEqual({ endSessionUrl: null });
  });

  it("schemat är strikt", () => {
    expect(signOutConfigSchema.safeParse({ endSessionUrl: null, extra: 1 }).success).toBe(false);
  });
});

describe("system.signOutConfig", () => {
  const prev = process.env.AVA_OIDC_END_SESSION_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.AVA_OIDC_END_SESSION_URL;
    else process.env.AVA_OIDC_END_SESSION_URL = prev;
  });

  it("läser serverns env", async () => {
    process.env.AVA_OIDC_END_SESSION_URL = ENTRA;
    const ds = new DemoDataStore({});
    const caller = appRouter.createCaller(buildContext({ dataStore: ds, ports: buildGitPorts(ds), principal: new GitAuthProvider().getPrincipal() }));
    expect(await caller.system.signOutConfig()).toEqual({ endSessionUrl: ENTRA });
  });
});
