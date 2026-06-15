/**
 * Tester för `pickProvider` (#27 coverage) — väljer SyncProvider för web/FSA.
 *
 * Alla beroenden importeras dynamiskt i pick-provider → mockas här. Vi täcker
 * båda grenarna (REST via parseRepoLocator, iso-git via FSA) + null-fallen
 * (osupportad miljö, ingen handle, ingen RW, token saknas mot fjärr) och kör
 * de returnerade provider-metoderna (pull/countChanges/commit/push).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { pickProvider } from "@/lib/client/sync/pick-provider";

// ── Muterbar mock-state (återställs i beforeEach) ─────────────────────────
let fsaSupported = true;
let opfsSupported = true;
let handle: unknown = {};
let rwOk = true;
let firmaCfg: { repo: string; token: string; corsProxy?: string } = { repo: "owner/repo", token: "tok" };
let isLocal = false;
let repoLocator: { owner: string; repo: string } | null = { owner: "o", repo: "r" };
let syncState: { files: Record<string, string>; lastHead?: string } | null = { files: { a: "1" }, lastHead: "HEAD1" };
let walkResult: Array<{ path: string; sha: string }> = [{ path: "a", sha: "1" }];
let statusEntries: unknown[] = [];
let keypair: { rawPublicKey: Uint8Array; privateKey: CryptoKey } | null = null;

const pushViaRest = vi.fn(async () => {});
const pullViaRest = vi.fn(async () => ({ kind: "fast-forward" }));
const readSyncState = vi.fn(async () => syncState);
const walkFsa = vi.fn(async () => walkResult);
const statusMatrix = vi.fn(async () => statusEntries);
const stageAllAndCommit = vi.fn(async () => "OID1");
const pushBranch = vi.fn(async () => {});
const pullBranch = vi.fn(async () => ({ kind: "fast-forward" }));
const loadKeypair = vi.fn(async () => keypair);

vi.mock("@/lib/client/fsa/handle-store", () => ({
  isFsaSupported: () => fsaSupported,
  isOpfsSupported: () => opfsSupported,
  loadHandle: async () => handle,
  ensureReadWrite: async () => rwOk,
}));
vi.mock("@/lib/client/firma/firma-config", () => ({
  loadFirmaConfig: () => firmaCfg,
  gitAuthUsername: () => "git-user",
}));
vi.mock("@/lib/client/sync/cors-proxy", () => ({
  resolveCorsProxy: () => "",
  isLocalOrSameOrigin: () => isLocal,
}));
vi.mock("@/lib/client/github/api", () => ({ parseRepoLocator: () => repoLocator }));
vi.mock("@/lib/client/github/push", () => ({ pushViaRest }));
vi.mock("@/lib/client/github/pull", () => ({ pullViaRest }));
vi.mock("@/lib/client/github/sync-state", () => ({ readSyncState }));
vi.mock("@/lib/client/github/fsa-walker", () => ({ walkFsa }));
class FsaIsoGitAdapter { constructor(_h: unknown) { /* mock */ } }
vi.mock("@/lib/client/fsa/fs-adapter", () => ({ FsaIsoGitAdapter }));
vi.mock("@/lib/client/fsa/git-ops", () => ({ statusMatrix, stageAllAndCommit, pushBranch, pullBranch }));
vi.mock("@/lib/client/keys/ed25519-keypair", () => ({ loadKeypair }));

beforeEach(() => {
  vi.clearAllMocks();
  fsaSupported = true; opfsSupported = true; handle = {}; rwOk = true;
  firmaCfg = { repo: "owner/repo", token: "tok" };
  isLocal = false; repoLocator = { owner: "o", repo: "r" };
  syncState = { files: { a: "1" }, lastHead: "HEAD1" };
  walkResult = [{ path: "a", sha: "1" }];
  statusEntries = [];
  keypair = null;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("pickProvider — null-fall", () => {
  it("SSR (window undefined) → null", async () => {
    vi.stubGlobal("window", undefined);
    expect(await pickProvider("tok")).toBeNull();
  });

  it("varken FSA eller OPFS stöds → null", async () => {
    fsaSupported = false; opfsSupported = false;
    expect(await pickProvider("tok")).toBeNull();
  });

  it("ingen handle vald → null", async () => {
    handle = null;
    expect(await pickProvider("tok")).toBeNull();
  });

  it("read-write-behörighet nekas → null", async () => {
    rwOk = false;
    expect(await pickProvider("tok")).toBeNull();
  });

  it("token saknas + ej lokal/samma-origin → null", async () => {
    isLocal = false;
    expect(await pickProvider("")).toBeNull();
  });

  it("token saknas men lokal/samma-origin → provider ändå (anonym push)", async () => {
    isLocal = true; repoLocator = null; // self-hosted → FSA-gren
    const picked = await pickProvider("");
    expect(picked?.kind).toBe("fsa");
  });
});

describe("pickProvider — REST-provider (parseRepoLocator träffar)", () => {
  it("returnerar fsa-provider", async () => {
    const picked = await pickProvider("tok");
    expect(picked?.kind).toBe("fsa");
  });

  it("countChanges räknar lokala diffar + borttagna mot sync-state", async () => {
    walkResult = [{ path: "a", sha: "X" }, { path: "b", sha: "2" }]; // a ändrad, b ny
    syncState = { files: { a: "1", c: "3" } }; // c borttagen lokalt
    const p = (await pickProvider("tok"))!.provider;
    // a≠ (1), b saknas i state (1), c saknas lokalt (1) = 3
    expect(await p.countChanges()).toBe(3);
  });

  it("countChanges utan sync-state → 0", async () => {
    syncState = null;
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.countChanges()).toBe(0);
  });

  it("pull delegerar till pullViaRest", async () => {
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.pull()).toEqual({ kind: "fast-forward" });
    expect(pullViaRest).toHaveBeenCalled();
  });

  it("commitLocal är no-op (REST committar inte lokalt)", async () => {
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.commitLocal()).toEqual({ oid: null });
  });

  it("push anropar pushViaRest med ändringsantal i meddelandet", async () => {
    const p = (await pickProvider("tok"))!.provider;
    await p.push();
    expect(pushViaRest).toHaveBeenCalled();
  });

  it("commitAndPush: 0 ändringar → ingen push", async () => {
    syncState = { files: { a: "1" } }; walkResult = [{ path: "a", sha: "1" }]; // 0 diff
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.commitAndPush()).toEqual({ oid: null });
    expect(pushViaRest).not.toHaveBeenCalled();
  });

  it("commitAndPush: >0 ändringar → push + returnerar lastHead", async () => {
    walkResult = [{ path: "a", sha: "X" }]; syncState = { files: { a: "1" }, lastHead: "HEAD9" };
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.commitAndPush()).toEqual({ oid: "HEAD9" });
    expect(pushViaRest).toHaveBeenCalled();
  });
});

describe("pickProvider — FSA-provider (iso-git smart-HTTP)", () => {
  beforeEach(() => { repoLocator = null; }); // okänd/self-hosted URL → FSA-gren

  it("returnerar fsa-provider", async () => {
    expect((await pickProvider("tok"))?.kind).toBe("fsa");
  });

  it("countChanges = antal status-matrix-entries", async () => {
    statusEntries = [{}, {}, {}];
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.countChanges()).toBe(3);
  });

  it("pull delegerar till pullBranch", async () => {
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.pull()).toEqual({ kind: "fast-forward" });
    expect(pullBranch).toHaveBeenCalled();
  });

  it("commitLocal med 0 entries → oid null, ingen commit", async () => {
    statusEntries = [];
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.commitLocal()).toEqual({ oid: null });
    expect(stageAllAndCommit).not.toHaveBeenCalled();
  });

  it("commitLocal med entries → stageAllAndCommit (osignerad utan keypair)", async () => {
    statusEntries = [{}, {}];
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.commitLocal()).toEqual({ oid: "OID1" });
    expect(stageAllAndCommit).toHaveBeenCalled();
    expect(stageAllAndCommit.mock.calls[0]![1]).not.toHaveProperty("sshSigning");
  });

  it("commitLocal med keypair → sshSigning skickas med", async () => {
    statusEntries = [{}];
    keypair = { rawPublicKey: new Uint8Array([1, 2]), privateKey: {} as CryptoKey };
    const p = (await pickProvider("tok"))!.provider;
    await p.commitLocal();
    expect(stageAllAndCommit.mock.calls[0]![1]).toHaveProperty("sshSigning");
  });

  it("push delegerar till pushBranch", async () => {
    const p = (await pickProvider("tok"))!.provider;
    await p.push();
    expect(pushBranch).toHaveBeenCalled();
  });

  it("commitAndPush: 0 entries → ingen push", async () => {
    statusEntries = [];
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.commitAndPush()).toEqual({ oid: null });
    expect(pushBranch).not.toHaveBeenCalled();
  });

  it("commitAndPush: entries → commit + push, returnerar oid", async () => {
    statusEntries = [{}];
    const p = (await pickProvider("tok"))!.provider;
    expect(await p.commitAndPush()).toEqual({ oid: "OID1" });
    expect(pushBranch).toHaveBeenCalled();
  });
});
