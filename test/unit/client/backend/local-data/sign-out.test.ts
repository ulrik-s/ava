/**
 * Logga ut (#1347): den lokala datan rensas, identiteten glöms, andra flikar
 * får veta det, och proxyns session avslutas via `/oauth2/sign_out` (vidare
 * till IdP:ns utloggning när driften konfigurerat den).
 */
import { waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { browserSignOutEnv, withinOrNull } from "@/lib/client/backend/local-data/browser-sign-out";
import {
  bindLocalNamespace, dbNameIn, LOCAL_DB, localScopeSchema, SHARED_NAMESPACE, unbindLocalNamespace, userNamespace,
} from "@/lib/client/backend/local-data/local-namespace";
import { onSignedOutElsewhere, SESSION_CHANNEL_NAME, sessionChannel } from "@/lib/client/backend/local-data/session-channel";
import {
  completeSignOut, PENDING_SIGN_OUT_KEY, pendingSignOutRedirect, proxySignOutUrl, signedOutLandingPath, signOut,
  type SignOutEnv,
} from "@/lib/client/backend/local-data/sign-out";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";

const anna = localScopeSchema.parse({ organizationId: "org-1", principalId: "u-anna" });

let factory: IDBFactory;
function makeEnv(over: Partial<SignOutEnv> = {}): SignOutEnv & { navigate: ReturnType<typeof vi.fn>; notifyOtherTabs: ReturnType<typeof vi.fn> } {
  return {
    factory,
    storage: localStorage,
    session: sessionStorage,
    tier: "self-hosted",
    basePath: "/ava",
    navigate: vi.fn(),
    online: () => true,
    notifyOtherTabs: vi.fn(),
    endSessionUrl: async () => null,
    timeoutMs: 200,
    ...over,
  } as SignOutEnv & { navigate: ReturnType<typeof vi.fn>; notifyOtherTabs: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  factory = new IDBFactory();
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("ava.firma", JSON.stringify({
    tier: "self-hosted", organizationId: "org-1", principalId: "u-anna", authorEmail: "anna@byra.se",
    authorName: "Anna", token: "t", sessionVerifiedAt: 1,
  }));
});
afterEach(() => { bindLocalNamespace(SHARED_NAMESPACE); });

describe("signOut", () => {
  it("rensar Annas lokala data, glömmer identiteten och går till proxyns utloggning", async () => {
    bindLocalNamespace(userNamespace(anna));
    const cache = dbNameIn(userNamespace(anna), LOCAL_DB.localStore);
    await new IndexedDbPersistence(factory, cache).save({} as never);
    localStorage.setItem("ava.outlookToken", "hemlig");
    localStorage.setItem("ava.theme", "dark");
    sessionStorage.setItem("msal.token", "hemlig");
    const env = makeEnv();

    await signOut(env);

    expect((await factory.databases()).map((d) => d.name)).not.toContain(cache);
    const cfg = JSON.parse(localStorage.getItem("ava.firma") ?? "{}");
    expect(cfg).toEqual({ tier: "self-hosted", organizationId: "org-1" });
    expect(localStorage.getItem("ava.outlookToken")).toBeNull();
    expect(localStorage.getItem("ava.theme")).toBe("dark"); // en webbläsarinställning, inte sessionens
    expect(sessionStorage.length).toBe(0);
    expect(env.notifyOtherTabs).toHaveBeenCalledTimes(1);
    expect(env.navigate).toHaveBeenCalledWith("/oauth2/sign_out?rd=%2Fava%2Flogin%2F%3FsignedOut%3D1");
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBe("1");
    expect(() => dbNameIn(userNamespace(anna), LOCAL_DB.localStore)).not.toThrow();
  });

  it("med IdP-utloggning konfigurerad: rd pekar dit", async () => {
    const env = makeEnv({ endSessionUrl: async () => "https://login.microsoftonline.com/t/oauth2/v2.0/logout?post_logout_redirect_uri=x" });
    await signOut(env);
    expect(env.navigate).toHaveBeenCalledWith(
      `/oauth2/sign_out?rd=${encodeURIComponent("https://login.microsoftonline.com/t/oauth2/v2.0/logout?post_logout_redirect_uri=x")}`,
    );
  });

  it("servern svarar inte på utloggnings-configen → bara proxyns utloggning", async () => {
    const env = makeEnv({ endSessionUrl: async () => { throw new Error("nere"); } });
    await signOut(env);
    expect(env.navigate).toHaveBeenCalledWith(proxySignOutUrl("/ava", null));
  });

  it("offline: allt lokalt görs, sidan går till roten och proxyns utloggning väntar till nästa start", async () => {
    const env = makeEnv({ online: () => false });
    await signOut(env);
    expect(env.navigate).toHaveBeenCalledWith("/ava/");
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBe("1");
    expect(JSON.parse(localStorage.getItem("ava.firma") ?? "{}").principalId).toBeUndefined();
  });

  it("demon: till kontoväljaren, ingen proxy", async () => {
    const env = makeEnv({ tier: "demo" });
    await signOut(env);
    expect(env.navigate).toHaveBeenCalledWith("/ava/login/");
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBeNull();
  });

  it("ett lagringsfel hindrar inte utloggningen (det rapporteras)", async () => {
    bindLocalNamespace(userNamespace(anna));
    const reported = vi.fn();
    const prev = globalThis.reportError;
    globalThis.reportError = reported;
    class BrokenFactory extends IDBFactory {
      override open(): IDBOpenDBRequest { throw new Error("idb trasig"); }
    }
    const env = makeEnv({ factory: new BrokenFactory() });
    await signOut(env);
    globalThis.reportError = prev;
    expect(reported).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringMatching(/kunde inte rensas/) }));
    expect(env.navigate).toHaveBeenCalled();
  });

  it("ingen bunden användare (obundet): ingen rensning, men utloggningen går igenom", async () => {
    unbindLocalNamespace();
    const env = makeEnv();
    await signOut(env);
    expect(env.navigate).toHaveBeenCalled();
  });
});

describe("pendingSignOutRedirect / completeSignOut", () => {
  it("väntande utloggning och proxyns session lever → proxyns utloggning, en gång", () => {
    localStorage.setItem(PENDING_SIGN_OUT_KEY, "1");
    expect(pendingSignOutRedirect(localStorage, "/ava", "authenticated")).toBe(proxySignOutUrl("/ava", null));
    expect(pendingSignOutRedirect(localStorage, "/ava", "authenticated")).toBeNull();
  });

  // #1418: landningssidan hann inte ta bort nyckeln (navigerade bort innan den
  // laddats klart) — nästa inloggning skickades då till utloggningen igen.
  it("väntande utloggning men proxyns session är redan slut → inget att avsluta, nyckeln tas bort", () => {
    for (const probe of ["signed-out", "absent"] as const) {
      localStorage.setItem(PENDING_SIGN_OUT_KEY, "1");
      expect(pendingSignOutRedirect(localStorage, "/ava", probe)).toBeNull();
      expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBeNull();
    }
  });

  it("proxyn nås inte (offline) → väntar till nästa start", () => {
    localStorage.setItem(PENDING_SIGN_OUT_KEY, "1");
    expect(pendingSignOutRedirect(localStorage, "", "unreachable")).toBeNull();
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBe("1");
  });

  it("ingen väntande utloggning → inget", () => {
    expect(pendingSignOutRedirect(localStorage, "", "authenticated")).toBeNull();
  });

  it("landningssidan avslutar den väntande utloggningen", () => {
    localStorage.setItem(PENDING_SIGN_OUT_KEY, "1");
    completeSignOut(localStorage);
    expect(localStorage.getItem(PENDING_SIGN_OUT_KEY)).toBeNull();
  });

  it("landningssidan", () => {
    expect(signedOutLandingPath("")).toBe("/login/?signedOut=1");
  });
});

describe("webbläsarens utloggning", () => {
  it("browserSignOutEnv kopplar webbläsarens lagring, navigering och sessionskanal", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, assign }, configurable: true });
    const env = browserSignOutEnv();
    expect(env.storage).toBe(window.localStorage);
    expect(env.session).toBe(window.sessionStorage);
    expect(env.online()).toBe(navigator.onLine);
    env.navigate("/x");
    expect(assign).toHaveBeenCalledWith("/x");
    const heard = vi.fn();
    const other = new BroadcastChannel(SESSION_CHANNEL_NAME);
    other.onmessage = heard;
    env.notifyOtherTabs();
    await waitFor(() => expect(heard).toHaveBeenCalled());
    other.close();
    // Servern svarar med configen (tRPC-svaret) → IdP:ns utloggnings-URL.
    const prevFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(
      JSON.stringify([{ result: { data: { json: { endSessionUrl: "https://idp.example/logout" } } } }]),
      { headers: { "content-type": "application/json" } },
    ));
    expect(await env.endSessionUrl()).toBe("https://idp.example/logout");
    globalThis.fetch = prevFetch;
  });

  it("sessionChannel är en kanal per flik", () => {
    expect(sessionChannel()).toBe(sessionChannel());
  });

  it("onSignedOutElsewhere: en annan flik loggar ut → den här laddar om", async () => {
    const reload = vi.fn();
    const off = onSignedOutElsewhere(reload);
    const other = new BroadcastChannel(SESSION_CHANNEL_NAME);
    other.postMessage("changed");
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    off();
    other.close();
  });

  it("onSignedOutElsewhere utan argument laddar om sidan", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
    const off = onSignedOutElsewhere();
    const other = new BroadcastChannel(SESSION_CHANNEL_NAME);
    other.postMessage("changed");
    await waitFor(() => expect(reload).toHaveBeenCalled());
    off();
    other.close();
  });

  it("withinOrNull: svaret om det hinner, annars null", async () => {
    expect(await withinOrNull(Promise.resolve("ja"), 50)).toBe("ja");
    expect(await withinOrNull(new Promise<string>(() => {}), 5)).toBeNull();
  });
});
