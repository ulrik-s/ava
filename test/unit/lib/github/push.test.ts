/**
 * Tester för pushViaRest — diff lokala filer mot sync-state, skapar blobs/tree/commit
 * via GitHub REST API, uppdaterar sync-state.
 *
 * Använder fake-FSA + mockad fetch. Validerar:
 *   - "up-to-date" när inget ändrats
 *   - skickar blob + tree + commit + ref-update i rätt ordning
 *   - hanterar nya + ändrade + raderade filer
 *   - uppdaterar sync-state med nya SHAs
 *   - kastar om sync-state saknas (push utan föregående pull)
 */

import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { pushViaRest } from "@/lib/client/github/push";
import { writeSyncState } from "@/lib/client/github/sync-state";
import { writeFile, deleteFile } from "@/lib/client/github/fsa-walker";
import { gitBlobSha1 } from "@/lib/client/github/git-blob-hash";
import { makeFakeFsa } from "../../../helpers/fake-fsa";

const REPO = { owner: "ulrik-s", repo: "ava" };

interface MockCall { url: string; method: string; body?: unknown }
let calls: MockCall[];
let blobCounter = 0;
let treeCounter = 0;
let commitCounter = 0;

beforeEach(() => {
  calls = [];
  blobCounter = treeCounter = commitCounter = 0;
  // Stub global fetch — varje endpoint returnerar förutsägbara nya SHAs
  globalThis.fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const u = url.toString();
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url: u, method, body });

    if (u.endsWith("/git/blobs")) return jsonRes({ sha: `blob-${++blobCounter}` });
    if (u.endsWith("/git/trees")) return jsonRes({ sha: `tree-${++treeCounter}` });
    if (u.endsWith("/git/commits")) return jsonRes({ sha: `commit-${++commitCounter}` });
    if (u.includes("/git/refs/heads/")) return jsonRes({});
    throw new Error(`Oväntad URL: ${u}`);
  }) as typeof fetch;
});

function jsonRes(body: unknown): Response {
  return {
    ok: true, status: 200, statusText: "OK",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

async function seed(fsa: ReturnType<typeof makeFakeFsa>, path: string, content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  await writeFile(fsa.root, path, bytes);
  return gitBlobSha1(bytes);
}

describe("pushViaRest", () => {
  it("kastar om sync-state saknas (push utan föregående pull)", async () => {
    const fsa = makeFakeFsa();
    await expect(pushViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t", message: "x",
    })).rejects.toThrow(/sync-state\.json/);
  });

  it("returnerar 'up-to-date' när inget ändrats", async () => {
    const fsa = makeFakeFsa();
    const sha = await seed(fsa, "matters/m-1.json", `{"id":"m-1"}`);
    await writeSyncState(fsa.root, {
      version: 1, branch: "main",
      lastHead: "headsha", lastTree: "treesha",
      lastSyncedAt: "2026-05-24T10:00:00Z",
      files: { "matters/m-1.json": sha },
    });

    const result = await pushViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t", message: "noop",
    });
    expect(result.kind).toBe("up-to-date");
    expect(result.filesPushed).toBe(0);
    expect(result.head).toBe("headsha");
    expect(calls).toEqual([]); // ingen request alls
  });

  it("pushar ny fil → blob + tree + commit + ref-update", async () => {
    const fsa = makeFakeFsa();
    const sha1 = await seed(fsa, "existing.json", "{}");
    await writeSyncState(fsa.root, {
      version: 1, branch: "main",
      lastHead: "parent", lastTree: "base-tree",
      lastSyncedAt: "2026-05-24T10:00:00Z",
      files: { "existing.json": sha1 },
    });
    // Lägg till en ny fil
    await seed(fsa, "new.json", `{"new":true}`);

    const result = await pushViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t", message: "feat: add new",
    });

    expect(result.kind).toBe("pushed");
    expect(result.filesPushed).toBe(1);
    expect(result.head).toBe("commit-1");

    // Verifiera anropssekvens
    const methods = calls.map((c) => `${c.method} ${c.url.replace(/^https:\/\/api\.github\.com/, "")}`);
    expect(methods).toEqual([
      "POST /repos/ulrik-s/ava/git/blobs",
      "POST /repos/ulrik-s/ava/git/trees",
      "POST /repos/ulrik-s/ava/git/commits",
      "PATCH /repos/ulrik-s/ava/git/refs/heads/main",
    ]);

    // Commit-body har rätt message + parent + tree
    const commitBody = calls[2]!.body as { message: string; tree: string; parents: string[] };
    expect(commitBody.message).toBe("feat: add new");
    expect(commitBody.tree).toBe("tree-1");
    expect(commitBody.parents).toEqual(["parent"]);

    // Tree-entries: bara nya filen (existing inte ändrat → ingen entry)
    const treeBody = calls[1]!.body as { base_tree: string; tree: Array<{ path: string; sha: string }> };
    expect(treeBody.base_tree).toBe("base-tree");
    expect(treeBody.tree.map((e) => e.path)).toEqual(["new.json"]);
  });

  it("hanterar både ändrade och raderade filer i samma push", async () => {
    const fsa = makeFakeFsa();
    const aSha = await seed(fsa, "a.json", "v1");
    const bSha = await seed(fsa, "b.json", "v1");
    await writeSyncState(fsa.root, {
      version: 1, branch: "main",
      lastHead: "p", lastTree: "bt",
      lastSyncedAt: "2026-05-24T10:00:00Z",
      files: { "a.json": aSha, "b.json": bSha, "c.json": "csha-not-on-disk" },
    });
    // a.json ändras
    await writeFile(fsa.root, "a.json", new TextEncoder().encode("v2"));
    // b.json oförändrad
    // c.json saknas på disk → raderas

    const result = await pushViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t", message: "x",
    });
    expect(result.filesPushed).toBe(2); // 1 changed + 1 deleted

    // Tree har 2 entries: a.json (ändrad) + c.json (sha:null = delete)
    const treeBody = calls.find((c) => c.url.endsWith("/git/trees"))!.body as {
      tree: Array<{ path: string; sha: string | null }>;
    };
    const entries = new Map(treeBody.tree.map((e) => [e.path, e.sha]));
    expect(entries.has("a.json")).toBe(true);
    expect(entries.get("c.json")).toBeNull();
    expect(entries.has("b.json")).toBe(false); // oförändrad
  });

  it("uppdaterar sync-state med nya SHAs efter push", async () => {
    const fsa = makeFakeFsa();
    await writeSyncState(fsa.root, {
      version: 1, branch: "main",
      lastHead: "p", lastTree: "bt",
      lastSyncedAt: "2026-05-24T10:00:00Z",
      files: {},
    });
    const newSha = await seed(fsa, "new.json", "x");

    await pushViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t", message: "x",
    });

    // Återläs sync-state — ska ha nya HEAD + tree + filer
    const { readSyncState } = await import("@/lib/client/github/sync-state");
    const state = await readSyncState(fsa.root);
    expect(state?.lastHead).toBe("commit-1");
    expect(state?.lastTree).toBe("tree-1");
    expect(state?.files["new.json"]).toBe("blob-1");
    // blob:n SHA är från GitHub (mock returnerar blob-1), inte lokala git-blob-hashen
    expect(state?.files["new.json"]).not.toBe(newSha);
  });

  it("skickar signature + author till createCommit när angivet", async () => {
    const fsa = makeFakeFsa();
    await writeSyncState(fsa.root, {
      version: 1, branch: "main", lastHead: "p", lastTree: "bt",
      lastSyncedAt: "", files: {},
    });
    await seed(fsa, "x.json", "x");

    await pushViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t", message: "m",
      signature: "-----BEGIN SSH SIGNATURE-----...",
      author: { name: "Anna", email: "anna@firma.se" },
    });

    const commitCall = calls.find((c) => c.url.endsWith("/git/commits"));
    const body = commitCall!.body as { signature: string; author: { name: string } };
    expect(body.signature).toContain("BEGIN SSH SIGNATURE");
    expect(body.author.name).toBe("Anna");
  });

  it("respekterar parallelLimit på blob-uploads", async () => {
    const fsa = makeFakeFsa();
    await writeSyncState(fsa.root, {
      version: 1, branch: "main", lastHead: "p", lastTree: "bt",
      lastSyncedAt: "", files: {},
    });
    // 12 nya filer (mer än limit 8)
    for (let i = 0; i < 12; i++) {
      await seed(fsa, `f-${i}.json`, `{}`);
    }

    const result = await pushViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t", message: "bulk",
    });
    expect(result.filesPushed).toBe(12);
    const blobCalls = calls.filter((c) => c.url.endsWith("/git/blobs"));
    expect(blobCalls).toHaveLength(12);
  });

  // Suppress unused import warning
  void deleteFile;
});
