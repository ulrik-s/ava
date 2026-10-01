/**
 * Tester för `bootstrapSelfHosted` (ADR 0016, cutover #420–#422) — self-hosted-
 * flippen från iso-git-clone till server-first-store. `makeStore`/`makeClient`
 * injiceras så vi testar orkestreringen utan riktig server/IndexedDB:
 *   - happy path: bygger store + klient, anropar onStoreReady + ready
 *   - OIDC-first-login (ingen principalId): läser allowlisten ur storens klient
 *   - #628: user.list returnerar `{ users }` (router-formen) → bind:en måste
 *     skicka ARRAYEN till classify, inte hela objektet (annars kastar
 *     OidcAuthProvider.find → boot fastnar tyst på "AVA Laddar…")
 *   - fel i store-bygget → error-status
 *   - avbruten (unmount) innan klar → ingen onStoreReady
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { bootstrapSelfHosted } from "@/components/shell/demo-bootstrap";
import { activeLocalScope, bindLocalNamespace, SHARED_NAMESPACE } from "@/lib/client/backend/local-data/local-namespace";
import type { FirmaConfig } from "@/lib/client/firma/firma-config";

const baseConfig: FirmaConfig = {
  tier: "self-hosted", repo: "https://firma.example/data.git", token: "",
  organizationId: "org", principalId: "p1", authorName: "A", authorEmail: "a@b.se",
};
// Utan principalId → OIDC-first-login-grenen aktiveras.
const { principalId: _omit, ...noPrincipal } = baseConfig;

// `user.list` returnerar router-formen `{ users }` (INTE en naken array) —
// matchar produktionen så bind-shapen testas på riktigt.
const fakeStore = { store: {} } as never;
/** Den inloggades lokala databaser (#1347) — en fejk-plats; `openLocal` testas för sig. */
const place = { factory: {} as IDBFactory, ns: { kind: "shared" as const }, adoptsLegacy: false };
function clientReturning(users: unknown[]) {
  return vi.fn(() => ({ user: { list: { query: vi.fn(async () => ({ users })) } } }) as never);
}
function makeArgs(over: Partial<Parameters<typeof bootstrapSelfHosted>[0]> = {}) {
  return {
    firmaConfig: baseConfig,
    queryClient: { invalidateQueries: vi.fn(async () => {}) } as never,
    setStatus: vi.fn(),
    setErrorMsg: vi.fn(),
    onStoreReady: vi.fn(),
    isCancelled: () => false,
    makeStore: vi.fn(async () => fakeStore),
    makeClient: clientReturning([]),
    openLocal: vi.fn(async (_cfg: unknown, args: { binding: boolean }) => (args.binding ? null : place)),
    pendingSignOut: () => null,
    ...over,
  };
}

// Konfigurerbara OIDC-mocks (sätts per test). Default: ingen oauth2-proxy.
const probeUserinfo = vi.fn(async (): Promise<unknown> => ({ kind: "absent" }));
const classifyOidcLogin = vi.fn(() => ({ kind: "no-session" }) as unknown);
vi.mock("@/lib/client/backend/oidc-principal", () => ({
  probeUserinfo: (...a: unknown[]) => probeUserinfo(...(a as [])),
  classifyOidcLogin: (...a: unknown[]) => classifyOidcLogin(...(a as [])),
}));

const NOW = Date.UTC(2026, 8, 30);
const gateEnv = () => ({ now: () => NOW, redirect: vi.fn(), location: () => ({ pathname: "/ava/matters/", search: "" }) });
const lena = { email: "a@b.se", subject: "", issuer: "", name: "A" };

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  probeUserinfo.mockResolvedValue({ kind: "absent" });
  classifyOidcLogin.mockReturnValue({ kind: "no-session" });
});

describe("bootstrapSelfHosted", () => {
  it("happy path: bygger store + klient, signalerar redo", async () => {
    const args = makeArgs();
    await bootstrapSelfHosted(args);
    expect(args.makeStore).toHaveBeenCalledTimes(1);
    // Samma identitet → den inloggades egna databaser (#1347).
    expect(args.openLocal).toHaveBeenCalledWith(baseConfig, { binding: false });
    expect(args.makeStore).toHaveBeenCalledWith(place);
    expect(args.makeClient).toHaveBeenCalledWith(fakeStore);
    expect(args.onStoreReady).toHaveBeenCalledWith(fakeStore, expect.anything());
    expect(args.setStatus).toHaveBeenCalledWith("ready");
    expect(args.setErrorMsg).not.toHaveBeenCalled();
  });

  it("avbruten innan klar → ingen onStoreReady/ready", async () => {
    const args = makeArgs({ isCancelled: () => true });
    await bootstrapSelfHosted(args);
    expect(args.onStoreReady).not.toHaveBeenCalled();
    expect(args.setStatus).not.toHaveBeenCalledWith("ready");
  });

  it("fel i store-bygget → error-status + meddelande", async () => {
    const args = makeArgs({ makeStore: vi.fn(async () => { throw new Error("server nere"); }) });
    await bootstrapSelfHosted(args);
    expect(args.setStatus).toHaveBeenCalledWith("error");
    expect(args.setErrorMsg).toHaveBeenCalledWith(expect.stringContaining("server nere"));
    expect(args.onStoreReady).not.toHaveBeenCalled();
  });

  it("OIDC-first-login (ingen principalId): frågar storens user.list", async () => {
    probeUserinfo.mockResolvedValueOnce({ kind: "ok", claims: lena });
    const listQuery = vi.fn(async () => ({ users: [] }));
    const args = makeArgs({
      firmaConfig: noPrincipal as FirmaConfig,
      makeClient: vi.fn(() => ({ user: { list: { query: listQuery } } }) as never),
    });
    await bootstrapSelfHosted(args);
    // Ny identitet → bindningsfasen: storen i minnet, inget sparas lokalt (#1347).
    expect(args.openLocal).toHaveBeenCalledWith(noPrincipal, { binding: true });
    expect(args.makeStore).toHaveBeenCalledWith("binding");
    expect(listQuery).toHaveBeenCalledTimes(1);
    expect(args.onStoreReady).toHaveBeenCalled();
    expect(args.setStatus).toHaveBeenCalledWith("ready");
  });

  it("#628: skickar user.list-ARRAYEN (inte {users}-objektet) till classify", async () => {
    probeUserinfo.mockResolvedValueOnce({ kind: "ok", claims: { email: "lawyer@ava.test", subject: "", issuer: "", name: "" } });
    const allowlist = [{ id: "u1", email: "lawyer@ava.test", name: "Lena", role: "LAWYER" }];
    const args = makeArgs({
      firmaConfig: noPrincipal as FirmaConfig,
      makeClient: clientReturning(allowlist),
    });
    await bootstrapSelfHosted(args);
    // Andra argumentet MÅSTE vara arrayen — inte `{ users: [...] }`.
    expect(classifyOidcLogin).toHaveBeenCalledWith(expect.anything(), allowlist);
  });

  it("#1391: inloggad men saknas i byrån → begripligt fel (inte 'Laddar…'), ingen store till appen", async () => {
    probeUserinfo.mockResolvedValueOnce({ kind: "ok", claims: lena });
    classifyOidcLogin.mockReturnValueOnce({ kind: "denied", email: "a@b.se" });
    const args = makeArgs({ firmaConfig: noPrincipal as FirmaConfig });
    await bootstrapSelfHosted(args);
    expect(args.setStatus).toHaveBeenCalledWith("error");
    expect(args.setErrorMsg).toHaveBeenCalledWith("Inte behörig: ditt konto (a@b.se) finns inte i byrån — kontakta administratören.");
    expect(args.onStoreReady).not.toHaveBeenCalled();
  });

  // ── Sessionsgrinden (#1245) ──────────────────────────────────────────────
  it("inloggad med samma identitet: bygger storen och noterar när sessionen verifierades", async () => {
    probeUserinfo.mockResolvedValueOnce({ kind: "ok", claims: lena });
    const args = makeArgs({ gateEnv: gateEnv() });
    await bootstrapSelfHosted(args);
    expect(args.setStatus).toHaveBeenCalledWith("ready");
    expect(JSON.parse(localStorage.getItem("ava.firma") ?? "{}")).toMatchObject({ sessionVerifiedAt: NOW });
  });

  it("utloggad: till inloggningen med tillbaka-länk — ingen store byggs", async () => {
    probeUserinfo.mockResolvedValueOnce({ kind: "unauthenticated" });
    const env = gateEnv();
    const args = makeArgs({ gateEnv: env });
    await bootstrapSelfHosted(args);
    expect(env.redirect).toHaveBeenCalledWith("/oauth2/start?rd=%2Fava%2Fmatters%2F");
    expect(args.makeStore).not.toHaveBeenCalled();
  });

  it("offline inom grace: arbetar vidare under den cachade identiteten", async () => {
    probeUserinfo.mockResolvedValueOnce({ kind: "unreachable" });
    const args = makeArgs({ gateEnv: gateEnv(), firmaConfig: { ...baseConfig, sessionVerifiedAt: NOW - 1000 } });
    await bootstrapSelfHosted(args);
    expect(args.setStatus).toHaveBeenCalledWith("ready");
  });

  it("utloggning offline som inte avslutade proxyns session (#1347): dit först, ingen grind, ingen store", async () => {
    const env = gateEnv();
    const args = makeArgs({ gateEnv: env, pendingSignOut: () => "/oauth2/sign_out?rd=x" });
    await bootstrapSelfHosted(args);
    expect(env.redirect).toHaveBeenCalledWith("/oauth2/sign_out?rd=x");
    expect(probeUserinfo).not.toHaveBeenCalled();
    expect(args.makeStore).not.toHaveBeenCalled();
  });

  it("webbläsarens defaults (#1347): den inloggades egna databaser binds, ingen väntande utloggning", async () => {
    const prevIdb = Reflect.get(globalThis, "indexedDB");
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    const { openLocal: _o, pendingSignOut: _p, ...defaults } = makeArgs();
    await bootstrapSelfHosted(defaults);
    Reflect.set(globalThis, "indexedDB", prevIdb);
    expect(defaults.makeStore).toHaveBeenCalledWith(expect.objectContaining({ ns: { kind: "user", scope: { organizationId: "org", principalId: "p1" } } }));
    expect(activeLocalScope()).toEqual({ organizationId: "org", principalId: "p1" });
    bindLocalNamespace(SHARED_NAMESPACE);
  });

  it("webbläsarens default: en väntande utloggning (online) går till proxyns utloggning", async () => {
    localStorage.setItem("ava.pendingSignOut", "1");
    const env = gateEnv();
    const { pendingSignOut: _p, ...args } = makeArgs({ gateEnv: env });
    await bootstrapSelfHosted(args);
    expect(env.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/oauth2\/sign_out\?rd=/));
  });

  it("offline efter grace: tydligt besked, ingen store", async () => {
    probeUserinfo.mockResolvedValueOnce({ kind: "unreachable" });
    const args = makeArgs({ gateEnv: gateEnv(), firmaConfig: { ...baseConfig, sessionVerifiedAt: NOW - 30 * 24 * 3600 * 1000 } });
    await bootstrapSelfHosted(args);
    expect(args.setStatus).toHaveBeenCalledWith("error");
    expect(args.setErrorMsg).toHaveBeenCalledWith(expect.stringMatching(/Anslut till nätet/));
    expect(args.makeStore).not.toHaveBeenCalled();
  });
});
