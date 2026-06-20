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
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { bootstrapSelfHosted } from "@/components/shell/demo-bootstrap";
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
    ...over,
  };
}

// Konfigurerbara OIDC-mocks (sätts per test).
const fetchOidcClaims = vi.fn(async () => null);
const classifyOidcLogin = vi.fn(() => ({ kind: "no-session" }) as unknown);
vi.mock("@/lib/client/backend/oidc-principal", () => ({
  fetchOidcClaims: (...a: unknown[]) => fetchOidcClaims(...(a as [])),
  classifyOidcLogin: (...a: unknown[]) => classifyOidcLogin(...(a as [])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  fetchOidcClaims.mockResolvedValue(null);
  classifyOidcLogin.mockReturnValue({ kind: "no-session" });
});

describe("bootstrapSelfHosted", () => {
  it("happy path: bygger store + klient, signalerar redo", async () => {
    const args = makeArgs();
    await bootstrapSelfHosted(args);
    expect(args.makeStore).toHaveBeenCalledTimes(1);
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
    const listQuery = vi.fn(async () => ({ users: [] }));
    const args = makeArgs({
      firmaConfig: noPrincipal as FirmaConfig,
      makeClient: vi.fn(() => ({ user: { list: { query: listQuery } } }) as never),
    });
    await bootstrapSelfHosted(args);
    expect(listQuery).toHaveBeenCalledTimes(1);
    expect(args.onStoreReady).toHaveBeenCalled();
    expect(args.setStatus).toHaveBeenCalledWith("ready");
  });

  it("#628: skickar user.list-ARRAYEN (inte {users}-objektet) till classify", async () => {
    fetchOidcClaims.mockResolvedValueOnce({ email: "lawyer@ava.test", subject: "", issuer: "", name: "" } as never);
    const allowlist = [{ id: "u1", email: "lawyer@ava.test", name: "Lena", role: "LAWYER" }];
    const args = makeArgs({
      firmaConfig: noPrincipal as FirmaConfig,
      makeClient: clientReturning(allowlist),
    });
    await bootstrapSelfHosted(args);
    // Andra argumentet MÅSTE vara arrayen — inte `{ users: [...] }`.
    expect(classifyOidcLogin).toHaveBeenCalledWith(expect.anything(), allowlist);
  });
});
