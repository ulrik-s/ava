/**
 * Tester för `bootstrapSelfHosted` (ADR 0016, cutover #420–#422) — self-hosted-
 * flippen från iso-git-clone till server-first-store. `makeStore`/`makeClient`
 * injiceras så vi testar orkestreringen utan riktig server/IndexedDB:
 *   - happy path: bygger store + klient, anropar onStoreReady + ready
 *   - OIDC-first-login (ingen principalId): läser allowlisten ur storens klient
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

// Minimal fejk-store + fejk-klient (vi testar bara orkestreringen).
const fakeStore = { store: {} } as never;
function makeArgs(over: Partial<Parameters<typeof bootstrapSelfHosted>[0]> = {}) {
  return {
    firmaConfig: baseConfig,
    queryClient: { invalidateQueries: vi.fn(async () => {}) } as never,
    setStatus: vi.fn(),
    setErrorMsg: vi.fn(),
    onStoreReady: vi.fn(),
    isCancelled: () => false,
    makeStore: vi.fn(async () => fakeStore),
    makeClient: vi.fn(() => ({ user: { list: { query: vi.fn(async () => []) } } }) as never),
    ...over,
  };
}

// fetchOidcClaims (anropas bara i OIDC-grenen) → mocka bort nätverket.
vi.mock("@/lib/client/backend/oidc-principal", () => ({
  fetchOidcClaims: vi.fn(async () => null),
  classifyOidcLogin: vi.fn(() => ({ kind: "no-session" })),
}));

beforeEach(() => vi.clearAllMocks());

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
    const listQuery = vi.fn(async () => []);
    const args = makeArgs({
      firmaConfig: noPrincipal as FirmaConfig,
      makeClient: vi.fn(() => ({ user: { list: { query: listQuery } } }) as never),
    });
    await bootstrapSelfHosted(args);
    expect(listQuery).toHaveBeenCalledTimes(1);
    // no-session-utfall → går vidare till ready (ingen reload/deny).
    expect(args.onStoreReady).toHaveBeenCalled();
    expect(args.setStatus).toHaveBeenCalledWith("ready");
  });
});
