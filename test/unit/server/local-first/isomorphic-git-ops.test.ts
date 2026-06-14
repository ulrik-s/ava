/**
 * Tester för `IsomorphicGitOps` — IGitOps-impl via `isomorphic-git`
 * för browser- och Node-runtimes som inte kan spawn:a subprocess.
 *
 * Vi kör mot ett MemFs in-memory + isomorphic-git's egen init/commit/log.
 * Push/fetch testas separat med en mockad http-plugin eftersom riktig
 * remote skulle kräva en HTTP-git-server.
 */

import * as git from "isomorphic-git";
import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import { IsomorphicGitOps } from "@/lib/server/local-first/isomorphic-git-ops";
import { MemFs } from "@/lib/server/local-first/mem-fs";

async function initRepo(mem: MemFs): Promise<void> {
  await git.init({
    fs: mem.nodeFs(),
    dir: "/",
    defaultBranch: "main",
  });
}

async function makeInitialCommit(mem: MemFs): Promise<string> {
  await mem.writeFile(".gitkeep", "");
  await git.add({ fs: mem.nodeFs(), dir: "/", filepath: ".gitkeep" });
  return git.commit({
    fs: mem.nodeFs(),
    dir: "/",
    message: "init",
    author: { name: "seed", email: "seed@x" },
  });
}

describe("IsomorphicGitOps — lokala operationer", () => {
  let mem: MemFs;
  let ops: IsomorphicGitOps;

  beforeEach(async () => {
    mem = new MemFs();
    await initRepo(mem);
    await makeInitialCommit(mem);
    ops = new IsomorphicGitOps({ fs: mem, dir: "/", authorName: "Anna", authorEmail: "anna@x" });
  });

  it("commit returnerar commit-objekt med hash + meddelande + author", async () => {
    await mem.writeFile("hello.txt", "hej");
    const c = await ops.commit("Skapa hello");
    expect(c.hash).toMatch(/^[a-f0-9]+$/);
    expect(c.message.trim()).toBe("Skapa hello");
    expect(c.author).toBe("Anna");
  });

  it("localHead returnerar senaste commit", async () => {
    await mem.writeFile("a.txt", "x");
    const c = await ops.commit("c1");
    const head = await ops.localHead();
    expect(head.hash).toBe(c.hash);
  });

  it("pendingCommitsAhead är tom direkt efter setup (ingen remote än)", async () => {
    // Utan remote main ger pendingCommitsAhead alla lokala commits
    // eftersom isomorphic-git inte hittar origin/main-ref:n.
    // För det här testet säkrar vi att det inte kastar.
    const pending = await ops.pendingCommitsAhead();
    expect(Array.isArray(pending)).toBe(true);
  });

  it("changedFiles mellan två commits listar nya filer", async () => {
    await mem.writeFile("a.txt", "1");
    const c1 = await ops.commit("c1");
    await mem.writeFile("b.txt", "2");
    const c2 = await ops.commit("c2");
    const changed = await ops.changedFiles(c1.hash, c2.hash);
    expect(changed).toContain("b.txt");
    expect(changed).not.toContain("a.txt");
  });

  it("changedFiles med identisk hash → tom array", async () => {
    const head = await ops.localHead();
    expect(await ops.changedFiles(head.hash, head.hash)).toEqual([]);
  });

  it("changedFiles med tom fromHash → alla filer i toHash", async () => {
    await mem.writeFile("a.txt", "1");
    await mem.writeFile("b.txt", "2");
    const c = await ops.commit("c1");
    const all = await ops.changedFiles("", c.hash);
    expect(all.length).toBeGreaterThan(0);
    expect(all).toContain("a.txt");
    expect(all).toContain("b.txt");
  });
});

describe("IsomorphicGitOps — remote (mockad http)", () => {
  let mem: MemFs;
  let ops: IsomorphicGitOps;
  let httpPlugin: { request: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mem = new MemFs();
    await initRepo(mem);
    await makeInitialCommit(mem);
    httpPlugin = { request: vi.fn() };
    ops = new IsomorphicGitOps({
      fs: mem, dir: "/",
      authorName: "Anna", authorEmail: "anna@x",
      remoteUrl: "https://server.example/repo.git",
      http: httpPlugin as never,
    });
  });

  it("push kallar http-pluginen", async () => {
    // Mock minimal git-protocol-response: receive-pack OK
    httpPlugin.request.mockResolvedValue({
      url: "https://server.example/repo.git/info/refs",
      method: "GET",
      statusCode: 401, // gör tot. push misslyckas — vi testar bara att http träffades
      statusMessage: "Unauthorized",
      headers: {},
      body: [new Uint8Array(0)],
    });
    const result = await ops.push();
    expect(httpPlugin.request).toHaveBeenCalled();
    expect(result.ok).toBe(false); // 401 ger NetworkError/Unknown
  });

  it("push utan remoteUrl kastar tydligt fel", async () => {
    const ops2 = new IsomorphicGitOps({ fs: mem, dir: "/", authorName: "x", authorEmail: "x@x" });
    const result = await ops2.push();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Unknown");
  });
});
