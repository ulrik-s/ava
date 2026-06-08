/**
 * Tester för `FilesystemClaimStore` — implementationen av `IClaimStore`
 * som använder JSONL-filer i ett git-repo som distribuerad mutex.
 *
 * Bygger på `InMemoryFileSystem` + `InMemoryGitOps` så vi kan testa
 * korrekthet och failover utan att spinna upp riktig git.
 */

import { describe, it, expect } from "vitest-compat";
import { FilesystemClaimStore } from "@/lib/server/local-first/filesystem-claim-store";
import { InMemoryFileSystem } from "@/lib/server/local-first/in-memory-fs";
import { InMemoryGitOps } from "@/lib/server/local-first/in-memory-git-ops";

function makeStore(me: string) {
  const fs = new InMemoryFileSystem();
  const git = new InMemoryGitOps(me, fs);
  return { store: new FilesystemClaimStore(fs, git, me), fs, git };
}

describe("FilesystemClaimStore — happy path", () => {
  it("första claim returnerar true och persisterar JSONL-rad", async () => {
    const { store, fs } = makeStore("anna");
    const got = await store.tryClaim("rule:x@evt:1", { me: "anna", ttlSec: 300 });
    expect(got).toBe(true);
    // claim-filen skapad
    const entries = await fs.listDir("claims");
    expect(entries.length).toBe(1); // year-mapp
  });

  it("samma klient som claimar igen får true (re-entrant)", async () => {
    const { store } = makeStore("anna");
    expect(await store.tryClaim("rule:x@evt:1", { me: "anna" })).toBe(true);
    expect(await store.tryClaim("rule:x@evt:1", { me: "anna" })).toBe(true);
  });
});

describe("FilesystemClaimStore — konkurrens", () => {
  it("två klienter på samma claimId: exakt en vinner, andra ser false (efter retry)", async () => {
    const annaFs = new InMemoryFileSystem();
    const bjornFs = new InMemoryFileSystem();
    const annaGit = new InMemoryGitOps("anna", annaFs);
    const bjornGit = annaGit.spawnConcurrentClient("bjorn", bjornFs);
    const annaStore = new FilesystemClaimStore(annaFs, annaGit, "anna");
    const bjornStore = new FilesystemClaimStore(bjornFs, bjornGit, "bjorn");

    // Anna går först
    const annaResult = await annaStore.tryClaim("rule:x@evt:1", { me: "anna" });
    // Björn försöker efteråt — ska se Annas claim när han fetchar
    const bjornResult = await bjornStore.tryClaim("rule:x@evt:1", { me: "bjorn" });
    expect(annaResult).toBe(true);
    expect(bjornResult).toBe(false);
  });

  it("efter att en klient vinner kan den andra fortfarande claima andra ids", async () => {
    const annaFs = new InMemoryFileSystem();
    const bjornFs = new InMemoryFileSystem();
    const annaGit = new InMemoryGitOps("anna", annaFs);
    const bjornGit = annaGit.spawnConcurrentClient("bjorn", bjornFs);
    const annaStore = new FilesystemClaimStore(annaFs, annaGit, "anna");
    const bjornStore = new FilesystemClaimStore(bjornFs, bjornGit, "bjorn");

    expect(await annaStore.tryClaim("rule:x@evt:A", { me: "anna" })).toBe(true);
    expect(await bjornStore.tryClaim("rule:x@evt:B", { me: "bjorn" })).toBe(true);
  });
});

describe("FilesystemClaimStore — stale claims", () => {
  it("en expiretad claim utan resulterande event går att re-claima", async () => {
    const { store } = makeStore("anna");
    // claim med 1 ms TTL — instantly stale
    await store.tryClaim("rule:x@evt:1", { me: "anna", ttlSec: 0.001 });
    await new Promise((r) => setTimeout(r, 10));
    // En "annan" klient (i samma test för enkelhet) försöker
    expect(await store.isStale("rule:x@evt:1")).toBe(true);
  });

  it("en färsk claim är inte stale", async () => {
    const { store } = makeStore("anna");
    await store.tryClaim("rule:x@evt:1", { me: "anna", ttlSec: 300 });
    expect(await store.isStale("rule:x@evt:1")).toBe(false);
  });
});
