/**
 * Tester för `LocalGitStore` — komposition av FilesystemEventLog,
 * FilesystemClaimStore och Prisma-delegates (mockade här).
 *
 * Bekräftar att den uppfyller `IDataStore`-kontraktet enligt
 * Liskov-substituionsprincipen — samma API som `PostgresStore`.
 */

import { describe, it, expect, vi } from "vitest";
import { LocalGitStore } from "@/server/local-first/local-git-store";
import { InMemoryFileSystem } from "@/server/local-first/in-memory-fs";
import { InMemoryGitOps } from "@/server/local-first/in-memory-git-ops";

function makeStore(me = "anna") {
  const fs = new InMemoryFileSystem();
  const git = new InMemoryGitOps(me, fs);
  const prismaMock = makePrismaMock();
  const store = new LocalGitStore({
    fs, git, me, prisma: prismaMock as never,
  });
  return { store, fs, git, prismaMock };
}

function makePrismaMock() {
  const delegate = () => ({
    findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(),
    create: vi.fn(), update: vi.fn(), delete: vi.fn(), count: vi.fn(),
  });
  return {
    matter: delegate(), matterContact: delegate(), contact: delegate(),
    document: delegate(), documentFolder: delegate(),
    documentTemplate: delegate(), documentAnalysisSuggestion: delegate(),
    matterEventSuggestion: delegate(), invoice: delegate(),
    timeEntry: delegate(), expense: delegate(), user: delegate(),
    organization: delegate(), office: delegate(), conflictCheck: delegate(),
  };
}

describe("LocalGitStore — IDataStore-kontrakt", () => {
  it("exponerar events med emit + query + onNewEvent", async () => {
    const { store } = makeStore();
    expect(typeof store.events.emit).toBe("function");
    expect(typeof store.events.query).toBe("function");
    expect(typeof store.events.onNewEvent).toBe("function");
  });

  it("exponerar claims (lokalt läge — claims-fält MÅSTE vara satt)", () => {
    const { store } = makeStore();
    expect(store.claims).toBeDefined();
    expect(typeof store.claims?.tryClaim).toBe("function");
  });

  it("alla Prisma-delegate-properties är satta", () => {
    const { store } = makeStore();
    const expected = [
      "matters", "matterContacts", "contacts", "documents", "documentFolders",
      "documentTemplates", "documentAnalysisSuggestions",
      "matterEventSuggestions", "invoices", "timeEntries", "expenses",
      "users", "organizations", "offices", "conflictChecks",
    ];
    for (const k of expected) {
      expect((store as unknown as Record<string, unknown>)[k]).toBeDefined();
    }
  });

  it("raw-escape-hatch pekar på prisma-instansen", () => {
    const { store, prismaMock } = makeStore();
    expect(store.raw).toBe(prismaMock);
  });
});

describe("LocalGitStore — integration", () => {
  it("emit + query end-to-end mot in-memory filsystem", async () => {
    const { store, fs } = makeStore();
    await store.events.emit({
      type: "matter.created",
      source: "ui",
      actor: { kind: "user", id: "anna" },
      matterId: "m1",
      payload: { matterNumber: "2026-0001" },
    });
    const events = await store.events.query({});
    expect(events).toHaveLength(1);
    expect(events[0].matterId).toBe("m1");
    // Filen ska finnas på disk i events/<år>/<mm>/<dd>.jsonl
    const today = new Date();
    const path = `events/${today.getUTCFullYear()}/${String(today.getUTCMonth() + 1).padStart(2, "0")}/${String(today.getUTCDate()).padStart(2, "0")}.jsonl`;
    expect(await fs.exists(path)).toBe(true);
  });

  it("claim tryClaim returnerar true vid första försök, false vid annans claim", async () => {
    const annaFs = new InMemoryFileSystem();
    const bjornFs = new InMemoryFileSystem();
    const annaGit = new InMemoryGitOps("anna", annaFs);
    const bjornGit = annaGit.spawnConcurrentClient("bjorn", bjornFs);
    const annaStore = new LocalGitStore({
      fs: annaFs, git: annaGit, me: "anna", prisma: makePrismaMock() as never,
    });
    const bjornStore = new LocalGitStore({
      fs: bjornFs, git: bjornGit, me: "bjorn", prisma: makePrismaMock() as never,
    });
    expect(await annaStore.claims!.tryClaim("rule:x@e1", { me: "anna" })).toBe(true);
    expect(await bjornStore.claims!.tryClaim("rule:x@e1", { me: "bjorn" })).toBe(false);
  });
});
