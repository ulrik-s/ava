/**
 * Tilläggets inloggning (addin-auth.ts): NAA mot en fejkad MSAL — tyst token i
 * första hand, Outlooks dialog bara när Entra kräver interaktion — och fasta
 * token för E2E och lokal utveckling.
 */

import type { AccountInfo, AuthenticationResult, Configuration, IPublicClientApplication } from "@azure/msal-browser";
import { describe, expect, it } from "vitest-compat";
import { avaScope, createAddinTokens, GRAPH_MAIL_SCOPE } from "@/lib/client/addin/addin-auth";

const ACCOUNT = { name: "Cecilia Moll", username: "cecilia@mgadvokater.se" } as AccountInfo;

interface FakeMsal {
  configs: Configuration[];
  silent: string[][];
  popup: string[][];
}

/** En fejkad MSAL-klient: `silentFails` = Entra kräver interaktion första gången. */
function fakeFactory(opts: { silentFails?: boolean } = {}) {
  const seen: FakeMsal = { configs: [], silent: [], popup: [] };
  let active: AccountInfo | null = null;
  const result = (scopes: string[]): AuthenticationResult =>
    ({ accessToken: `token:${scopes.join(" ")}`, account: ACCOUNT }) as AuthenticationResult;
  const pca: Pick<IPublicClientApplication, "acquireTokenSilent" | "acquireTokenPopup" | "getActiveAccount" | "getAllAccounts" | "setActiveAccount"> = {
    acquireTokenSilent: (req) => {
      seen.silent.push(req.scopes);
      return opts.silentFails ? Promise.reject(new Error("interaction_required")) : Promise.resolve(result(req.scopes));
    },
    acquireTokenPopup: (req) => { seen.popup.push(req.scopes); return Promise.resolve(result(req.scopes)); },
    getActiveAccount: () => active,
    getAllAccounts: () => (active ? [active] : []),
    setActiveAccount: (a) => { active = a; },
  };
  const create = (config: Configuration) => {
    seen.configs.push(config);
    return Promise.resolve(pca as IPublicClientApplication);
  };
  return { seen, create };
}

const CONFIG = { clientId: "73542ff5", tenantId: "c503234f" };

describe("NAA", () => {
  it("använder byråns tenant och AVA-appens klient-id", async () => {
    const { seen, create } = fakeFactory();
    await createAddinTokens(CONFIG, create);
    expect(seen.configs[0]?.auth).toEqual({ clientId: "73542ff5", authority: "https://login.microsoftonline.com/c503234f" });
  });

  it("hämtar AVA- och Graph-token tyst med rätt scope", async () => {
    const { seen, create } = fakeFactory();
    const tokens = await createAddinTokens(CONFIG, create);
    expect(await tokens.ava()).toBe("token:api://73542ff5/access_as_user");
    expect(await tokens.graph()).toBe(`token:${GRAPH_MAIL_SCOPE}`);
    expect(seen.silent).toEqual([[avaScope("73542ff5")], [GRAPH_MAIL_SCOPE]]);
    expect(seen.popup).toEqual([]);
  });

  it("kräver Entra interaktion: Outlooks dialog, och kontot kommer ihåg", async () => {
    const { seen, create } = fakeFactory({ silentFails: true });
    const tokens = await createAddinTokens(CONFIG, create);
    expect(tokens.user()).toBeNull();
    expect(await tokens.ava()).toBe("token:api://73542ff5/access_as_user");
    expect(seen.popup).toEqual([[avaScope("73542ff5")]]);
    expect(tokens.user()).toEqual({ name: "Cecilia Moll", username: "cecilia@mgadvokater.se" });
  });
});

describe("fasta token", () => {
  it("används utan MSAL (E2E och lokal utveckling)", async () => {
    const { seen, create } = fakeFactory();
    const tokens = await createAddinTokens({ ...CONFIG, staticTokens: { ava: "a", graph: "g", name: "Björn" } }, create);
    expect(await tokens.ava()).toBe("a");
    expect(await tokens.graph()).toBe("g");
    expect(tokens.user()?.name).toBe("Björn");
    expect(seen.configs).toEqual([]);
  });
});
