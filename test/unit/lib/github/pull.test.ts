/**
 * Tester för pullViaRest — diffar remote tree mot lokal sync-state,
 * hämtar/raderar filer, skriver ny sync-state.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { pullViaRest } from "@/client/lib/github/pull";
import { writeSyncState, readSyncState } from "@/client/lib/github/sync-state";
import { writeFile } from "@/client/lib/github/fsa-walker";
import { gitBlobSha1 } from "@/client/lib/github/git-blob-hash";
import { makeFakeFsa } from "../../../helpers/fake-fsa";

const REPO = { owner: "ulrik-s", repo: "ava" };

interface MockResponses {
  head?: string;
  tree?: { sha: string; truncated?: boolean; tree: Array<{ path: string; type: string; sha: string }> };
  commitTreeSha?: string;
  blobs?: Record<string, { content: string; encoding: "base64" | "utf-8" }>;
}

function mockGitHub(responses: MockResponses): typeof fetch {
  return vi.fn(async (url: URL | RequestInfo) => {
    const u = url.toString();
    const json = (body: unknown): Response => ({
      ok: true, status: 200, statusText: "OK",
      text: async () => JSON.stringify(body),
      json: async () => body,
    } as Response);

    if (u.match(/\/git\/ref\/heads\//)) {
      return json({ object: { sha: responses.head ?? "newhead" } });
    }
    if (u.match(/\/git\/commits\/[^/]+$/)) {
      return json({
        sha: "commitsha",
        message: "x",
        tree: { sha: responses.commitTreeSha ?? "treesha" },
        parents: [], author: { name: "", email: "", date: "" }, committer: { name: "", email: "", date: "" },
      });
    }
    if (u.match(/\/git\/trees\/[^?]+\?recursive=1$/)) {
      return json(responses.tree ?? { sha: "treesha", truncated: false, tree: [] });
    }
    const blobMatch = u.match(/\/git\/blobs\/([^/]+)$/);
    if (blobMatch) {
      const sha = blobMatch[1];
      const b = responses.blobs?.[sha] ?? { content: btoa("default"), encoding: "base64" as const };
      return json({ sha, size: 0, ...b });
    }
    throw new Error(`Oväntad URL: ${u}`);
  }) as typeof fetch;
}

beforeEach(() => { /* fresh fetch per test */ });

describe("pullViaRest", () => {
  it("returnerar 'up-to-date' när lokal HEAD matchar remote", async () => {
    const fsa = makeFakeFsa();
    await writeSyncState(fsa.root, {
      version: 1, branch: "main",
      lastHead: "samesha", lastTree: "t",
      lastSyncedAt: "", files: {},
    });
    globalThis.fetch = mockGitHub({ head: "samesha" });

    const result = await pullViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t",
    });
    expect(result).toEqual({ kind: "up-to-date", head: "samesha", filesUpdated: 0 });
  });

  it("hämtar saknade filer från remote vid första pull (ingen sync-state)", async () => {
    const fsa = makeFakeFsa();
    globalThis.fetch = mockGitHub({
      head: "newhead",
      tree: {
        sha: "t1", truncated: false,
        tree: [
          { path: "matters/m-1.json", type: "blob", sha: "blobA" },
          { path: "contacts/c-1.json", type: "blob", sha: "blobB" },
        ],
      },
      blobs: {
        blobA: { content: btoa(`{"id":"m-1"}`), encoding: "base64" },
        blobB: { content: btoa(`{"id":"c-1"}`), encoding: "base64" },
      },
    });

    const result = await pullViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t",
    });
    expect(result.kind).toBe("fast-forward");
    expect(result.filesUpdated).toBe(2);
    expect(fsa.readFile("matters/m-1.json")).not.toBeNull();
    expect(fsa.readFile("contacts/c-1.json")).not.toBeNull();
  });

  it("hoppar över filer som redan är lokala med rätt SHA", async () => {
    const fsa = makeFakeFsa();
    const sameBytes = new TextEncoder().encode("same content");
    await writeFile(fsa.root, "stable.json", sameBytes);
    const sha = await gitBlobSha1(sameBytes);
    await writeSyncState(fsa.root, {
      version: 1, branch: "main", lastHead: "old", lastTree: "ot",
      lastSyncedAt: "", files: { "stable.json": sha },
    });

    let blobFetched = false;
    globalThis.fetch = vi.fn(async (url: URL | RequestInfo) => {
      const u = url.toString();
      if (u.includes("/git/blobs/")) blobFetched = true;
      return mockGitHub({
        head: "newhead",
        tree: { sha: "t", truncated: false, tree: [{ path: "stable.json", type: "blob", sha }] },
      })(url, undefined as never);
    }) as typeof fetch;

    const result = await pullViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t",
    });
    expect(result.filesUpdated).toBe(0);
    expect(blobFetched).toBe(false); // ingen blob hämtad eftersom lokal redan matchar
  });

  it("raderar lokala filer som inte längre finns i remote", async () => {
    const fsa = makeFakeFsa();
    await writeFile(fsa.root, "deleted-me.json", new TextEncoder().encode("x"));
    await writeFile(fsa.root, "kept.json", new TextEncoder().encode("y"));
    const keptSha = await gitBlobSha1(new TextEncoder().encode("y"));

    await writeSyncState(fsa.root, {
      version: 1, branch: "main", lastHead: "old", lastTree: "ot",
      lastSyncedAt: "",
      files: { "deleted-me.json": "oldsha", "kept.json": keptSha },
    });
    globalThis.fetch = mockGitHub({
      head: "newhead",
      tree: { sha: "t", truncated: false, tree: [{ path: "kept.json", type: "blob", sha: keptSha }] },
    });

    const result = await pullViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t",
    });
    expect(result.filesUpdated).toBe(1); // 1 deleted
    expect(fsa.readFile("deleted-me.json")).toBeNull();
    expect(fsa.readFile("kept.json")).not.toBeNull();
  });

  it("kastar vid truncated tree (för stort repo)", async () => {
    const fsa = makeFakeFsa();
    globalThis.fetch = mockGitHub({
      head: "newhead",
      tree: { sha: "t", truncated: true, tree: [] },
    });
    await expect(pullViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t",
    })).rejects.toThrow(/truncated|för stort/i);
  });

  it("uppdaterar sync-state med ny HEAD + tree + files", async () => {
    const fsa = makeFakeFsa();
    globalThis.fetch = mockGitHub({
      head: "newhead",
      commitTreeSha: "newtree",
      tree: { sha: "newtree", truncated: false, tree: [{ path: "x.json", type: "blob", sha: "xsha" }] },
      blobs: { xsha: { content: btoa("{}"), encoding: "base64" } },
    });

    await pullViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t",
    });
    const state = await readSyncState(fsa.root);
    expect(state?.lastHead).toBe("newhead");
    expect(state?.lastTree).toBe("newtree");
    expect(state?.files).toEqual({ "x.json": "xsha" });
  });

  it("hanterar utf-8-kodade blobs", async () => {
    const fsa = makeFakeFsa();
    globalThis.fetch = mockGitHub({
      head: "newhead",
      tree: { sha: "t", truncated: false, tree: [{ path: "text.md", type: "blob", sha: "txt" }] },
      blobs: { txt: { content: "Hej, världen!", encoding: "utf-8" } },
    });
    await pullViaRest({
      handle: fsa.root, repo: REPO, branch: "main", token: "t",
    });
    const bytes = fsa.readFile("text.md");
    expect(new TextDecoder().decode(bytes!)).toBe("Hej, världen!");
  });
});
