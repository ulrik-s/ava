/**
 * Tester för GitHub REST API-wrappers.
 *
 * Testar mot mockad fetch. Validerar:
 *   - URL-konstruktion
 *   - auth-headers
 *   - request-body
 *   - error-mapping (status + GitHub-style {message} body)
 *   - base64-encoding/decoding
 *   - parseRepoLocator-varianter (kortform vs github.com)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  base64ToBytes,
  createBlob,
  createCommit,
  createTree,
  getBlob,
  getBranchHead,
  getCommit,
  getTreeRecursive,
  parseRepoLocator,
  updateRef,
} from "@/lib/client/github/api";

const REPO = { owner: "ulrik-s", repo: "ava" };
const OPTS = { token: "ghp_test" };

interface MockCall { url: string; init?: RequestInit }
let calls: MockCall[];

function mockFetch(impl: (call: MockCall) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
    const call = { url: url.toString(), init };
    calls.push(call);
    return impl(call);
  }) as typeof fetch;
}

function jsonRes(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "ERR",
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as Response;
}

beforeEach(() => { calls = []; });
afterEach(() => { vi.unstubAllGlobals(); });

describe("parseRepoLocator", () => {
  it("matchar kortform owner/repo", () => {
    expect(parseRepoLocator("ulrik-s/ava")).toEqual({ owner: "ulrik-s", repo: "ava" });
  });
  it("matchar github.com-URL", () => {
    expect(parseRepoLocator("https://github.com/ulrik-s/ava")).toEqual({ owner: "ulrik-s", repo: "ava" });
  });
  it("strippar .git-suffix", () => {
    expect(parseRepoLocator("https://github.com/ulrik-s/ava.git")).toEqual({ owner: "ulrik-s", repo: "ava" });
    expect(parseRepoLocator("ulrik-s/ava.git")).toEqual({ owner: "ulrik-s", repo: "ava" });
  });
  it("matchar ssh-style git@github.com:user/repo", () => {
    expect(parseRepoLocator("git@github.com:ulrik-s/ava.git")).toEqual({ owner: "ulrik-s", repo: "ava" });
  });
  it("returnerar null för icke-GitHub-URL", () => {
    expect(parseRepoLocator("https://git.firma.se/data.git")).toBeNull();
    expect(parseRepoLocator("")).toBeNull();
    expect(parseRepoLocator("not-a-url")).toBeNull();
  });
});

describe("base64ToBytes", () => {
  it("avkodar standard-base64", () => {
    expect(new TextDecoder().decode(base64ToBytes("aGVqIQ=="))).toBe("hej!");
  });
  it("ignorerar whitespace (GH returnerar radbrytningar)", () => {
    const b64 = "aGVq" + "\n" + "IQ==";
    expect(new TextDecoder().decode(base64ToBytes(b64))).toBe("hej!");
  });
});

describe("getBranchHead", () => {
  it("returnerar sha från /git/ref/heads/<branch>", async () => {
    mockFetch(() => jsonRes({ object: { sha: "abc123" } }));
    expect(await getBranchHead(REPO, "main", OPTS)).toBe("abc123");
    expect(calls[0].url).toBe("https://api.github.com/repos/ulrik-s/ava/git/ref/heads/main");
    expect((calls[0].init?.headers as Record<string, string>)?.Authorization).toBe("Bearer ghp_test");
  });

  it("kastar med statusText + body.message vid fel", async () => {
    mockFetch(() => jsonRes({ message: "Not Found" }, 404));
    await expect(getBranchHead(REPO, "nonexistent", OPTS)).rejects.toThrow(/getBranchHead.*404.*Not Found/);
  });

  it("URL-encodar branch-namn", async () => {
    mockFetch(() => jsonRes({ object: { sha: "x" } }));
    await getBranchHead(REPO, "feature/foo bar", OPTS);
    expect(calls[0].url).toContain("feature%2Ffoo%20bar");
  });
});

describe("getCommit + getTreeRecursive + getBlob", () => {
  it("getCommit anropar /git/commits/<sha>", async () => {
    const commit = {
      sha: "abc", message: "x", tree: { sha: "t" }, parents: [],
      author: { name: "A", email: "a@x", date: "" },
      committer: { name: "A", email: "a@x", date: "" },
    };
    mockFetch(() => jsonRes(commit));
    expect(await getCommit(REPO, "abc", OPTS)).toEqual(commit);
    expect(calls[0].url).toContain("/git/commits/abc");
  });

  it("getTreeRecursive lägger till ?recursive=1", async () => {
    mockFetch(() => jsonRes({ sha: "t", truncated: false, tree: [] }));
    await getTreeRecursive(REPO, "treesha", OPTS);
    expect(calls[0].url).toContain("/git/trees/treesha?recursive=1");
  });

  it("getBlob returnerar fil-innehåll i base64", async () => {
    const blob = { sha: "b", content: "aGVq", encoding: "base64", size: 3 };
    mockFetch(() => jsonRes(blob));
    expect(await getBlob(REPO, "b", OPTS)).toEqual(blob);
  });
});

describe("createBlob", () => {
  it("postar base64-kodade bytes och returnerar sha", async () => {
    mockFetch(() => jsonRes({ sha: "newblob" }));
    const sha = await createBlob(REPO, new TextEncoder().encode("hej"), OPTS);
    expect(sha).toBe("newblob");
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.encoding).toBe("base64");
    expect(body.content).toBe(btoa("hej"));
  });
});

describe("createTree", () => {
  it("inkluderar base_tree om angivet", async () => {
    mockFetch(() => jsonRes({ sha: "newtree" }));
    await createTree(REPO, "basesha", [
      { path: "a.json", mode: "100644", type: "blob", sha: "blob1" },
    ], OPTS);
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.base_tree).toBe("basesha");
    expect(body.tree).toHaveLength(1);
  });

  it("utelämnar base_tree när det är null (rena trädet)", async () => {
    mockFetch(() => jsonRes({ sha: "newtree" }));
    await createTree(REPO, null, [], OPTS);
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body).not.toHaveProperty("base_tree");
  });

  it("tillåter sha=null för raderingar", async () => {
    mockFetch(() => jsonRes({ sha: "newtree" }));
    await createTree(REPO, "base", [
      { path: "removed.json", mode: "100644", type: "blob", sha: null },
    ], OPTS);
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.tree[0].sha).toBeNull();
  });
});

describe("createCommit", () => {
  it("postar message + tree + parents", async () => {
    mockFetch(() => jsonRes({ sha: "newcommit" }));
    const sha = await createCommit(REPO, {
      message: "Add foo", tree: "treesha", parents: ["parent1"],
    }, OPTS);
    expect(sha).toBe("newcommit");
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.message).toBe("Add foo");
    expect(body.parents).toEqual(["parent1"]);
  });

  it("inkluderar signature + author när angivet", async () => {
    mockFetch(() => jsonRes({ sha: "newcommit" }));
    await createCommit(REPO, {
      message: "x", tree: "t", parents: [],
      signature: "-----BEGIN SSH SIGNATURE-----...",
      author: { name: "Anna", email: "anna@firma.se" },
    }, OPTS);
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.signature).toContain("BEGIN SSH SIGNATURE");
    expect(body.author.name).toBe("Anna");
  });
});

describe("updateRef", () => {
  it("PATCH:ar refs/heads/<branch> med ny sha", async () => {
    mockFetch(() => jsonRes({}));
    await updateRef(REPO, "main", "newsha", OPTS);
    expect(calls[0].url).toContain("/git/refs/heads/main");
    expect(calls[0].init?.method).toBe("PATCH");
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.sha).toBe("newsha");
    expect(body.force).toBe(false);
  });

  it("skickar force=true när opts.force = true", async () => {
    mockFetch(() => jsonRes({}));
    await updateRef(REPO, "main", "x", { ...OPTS, force: true });
    const body = JSON.parse(calls[0].init!.body as string);
    expect(body.force).toBe(true);
  });

  it("kastar med error.message vid 422 (force-push without permission)", async () => {
    mockFetch(() => jsonRes({ message: "Update is not a fast forward" }, 422));
    await expect(updateRef(REPO, "main", "x", OPTS)).rejects.toThrow(/Update is not a fast forward/);
  });
});

describe("error handling", () => {
  it("hanterar non-JSON body i felmeddelandet", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      statusText: "Server Error",
      text: async () => "Internal server crash",
      json: async () => { throw new Error("not json"); },
    } as unknown as Response)) as typeof fetch;
    await expect(getBranchHead(REPO, "main", OPTS)).rejects.toThrow(/500.*Internal server crash/);
  });
});
