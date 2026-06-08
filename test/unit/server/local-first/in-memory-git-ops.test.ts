import { describe, it, expect } from "vitest-compat";
import { InMemoryGitOps } from "@/lib/server/local-first/in-memory-git-ops";

describe("InMemoryGitOps", () => {
  it("commit + push gör att senaste commit blir visibel för andra klienter", async () => {
    const annaOps = new InMemoryGitOps("anna");
    const bjornOps = annaOps.spawnConcurrentClient("bjorn");
    await annaOps.commit("Anna A");
    expect((await annaOps.pendingCommitsAhead()).length).toBe(1);
    const pushResult = await annaOps.push();
    expect(pushResult.ok).toBe(true);
    // Björn ser den efter fetch
    await bjornOps.fetch();
    expect((await bjornOps.remoteHead()).message).toBe("Anna A");
  });

  it("samtidig push: bara en lyckas, andra får NonFastForward", async () => {
    const a = new InMemoryGitOps("a");
    const b = a.spawnConcurrentClient("b");
    await a.commit("A");
    await b.commit("B");
    const aResult = await a.push();
    const bResult = await b.push();
    expect(aResult.ok).toBe(true);
    expect(bResult.ok).toBe(false);
    expect(bResult.reason).toBe("NonFastForward");
  });

  it("efter NonFastForward kan klienten reset-hard-fetcha och rebuild:a", async () => {
    const a = new InMemoryGitOps("a");
    const b = a.spawnConcurrentClient("b");
    await a.commit("A");
    await b.commit("B");
    await a.push();
    expect((await b.push()).ok).toBe(false);
    await b.resetHardToRemote();
    expect((await b.pendingCommitsAhead()).length).toBe(0);
    // Nu kan b commit:a på toppen och pusha
    await b.commit("B på toppen av A");
    expect((await b.push()).ok).toBe(true);
  });

  it("fetch-without-changes returnerar samma headHash", async () => {
    const a = new InMemoryGitOps("a");
    const h1 = await a.remoteHead();
    await a.fetch();
    const h2 = await a.remoteHead();
    expect(h2.hash).toBe(h1.hash);
  });

  it("commit returnerar nytt commit-objekt med hash + meddelande", async () => {
    const a = new InMemoryGitOps("a");
    const c = await a.commit("hello");
    expect(c.hash).toMatch(/^[a-f0-9]+$/);
    expect(c.message).toBe("hello");
    expect(c.author).toBe("a");
  });
});
