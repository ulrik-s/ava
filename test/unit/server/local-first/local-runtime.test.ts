/**
 * Tester för `LocalRuntime` — composition root som binder ihop alla
 * local-first-komponenter (filsystem, git, prisma, projection-system,
 * sync-loop) till ett lättanvänt API.
 *
 * Designmål för testbarhet:
 *   - Dependency injection: `LocalRuntime.create(deps)` accepterar
 *     fabriks-funktioner så testen kan injicera in-memory-impl.
 *   - `shutdown()` är synkron + idempotent.
 *
 * SOLID:
 *   - Single responsibility: Wire-up. Klassen själv har ingen domain-logik.
 *   - DI: alla beroenden tas via constructor / fabriks-deps.
 *   - Liskov: returnerar IDataStore som tRPC-routern kan använda
 *     identiskt med PostgresStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LocalRuntime } from "@/server/local-first/local-runtime";
import { InMemoryFileSystem } from "@/server/local-first/in-memory-fs";
import { InMemoryGitOps } from "@/server/local-first/in-memory-git-ops";
import type { PrismaClient } from "@prisma/client";

function makePrismaMock(): PrismaClient {
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
    $disconnect: vi.fn(async () => {}),
  } as unknown as PrismaClient;
}

describe("LocalRuntime", () => {
  let prisma: PrismaClient;
  let fs: InMemoryFileSystem;
  let git: InMemoryGitOps;
  let runtime: LocalRuntime;

  beforeEach(() => {
    prisma = makePrismaMock();
    fs = new InMemoryFileSystem();
    git = new InMemoryGitOps("anna", fs);
    runtime = LocalRuntime.create({
      fs, git, prisma, me: "anna",
    });
  });

  afterEach(async () => {
    await runtime.shutdown();
  });

  describe("uppsättning", () => {
    it("exponerar en IDataStore", () => {
      expect(runtime.dataStore).toBeDefined();
      expect(runtime.dataStore.events).toBeDefined();
      expect(runtime.dataStore.claims).toBeDefined();
    });

    it("exponerar `me` (commit-author + claim-owner)", () => {
      expect(runtime.me).toBe("anna");
    });

    it("dataStore.matters pekar på prisma.matter (samma referens)", () => {
      expect(runtime.dataStore.matters).toBe(prisma.matter);
    });

    it("exponerar syncLoop (men startar den inte automatiskt)", () => {
      expect(runtime.syncLoop).toBeDefined();
    });
  });

  describe("Liskov mot IDataStore", () => {
    it("har samma 15 delegate-properties som PostgresStore", () => {
      const expected = [
        "matters", "matterContacts", "contacts", "documents",
        "documentFolders", "documentTemplates",
        "documentAnalysisSuggestions", "matterEventSuggestions",
        "invoices", "timeEntries", "expenses", "users",
        "organizations", "offices", "conflictChecks",
      ];
      for (const k of expected) {
        expect(
          (runtime.dataStore as unknown as Record<string, unknown>)[k],
          `dataStore.${k} saknas`,
        ).toBeDefined();
      }
    });

    it("har raw-escape-hatch", () => {
      expect(runtime.dataStore.raw).toBe(prisma);
    });
  });

  describe("lifecycle", () => {
    it("shutdown stoppar sync-loop och disconnectar prisma", async () => {
      runtime.startSync(); // explicit
      const stopSpy = vi.spyOn(runtime.syncLoop, "stop");
      await runtime.shutdown();
      expect(stopSpy).toHaveBeenCalled();
      expect(prisma.$disconnect).toHaveBeenCalled();
    });

    it("shutdown är idempotent — andra anrop är no-op", async () => {
      await runtime.shutdown();
      // Andra anropet ska inte krascha eller dubbel-anropa $disconnect
      await expect(runtime.shutdown()).resolves.toBeUndefined();
      expect(prisma.$disconnect).toHaveBeenCalledTimes(1);
    });

    it("startSync kan kallas innan shutdown utan att krascha", () => {
      expect(() => runtime.startSync()).not.toThrow();
    });

    it("startSync är idempotent (delegerar till SyncLoop.start)", () => {
      runtime.startSync();
      runtime.startSync(); // ska vara OK
    });
  });

  describe("Round-trip mot in-memory filsystem", () => {
    it("event emit hamnar i filsystemet", async () => {
      await runtime.dataStore.events.emit({
        type: "matter.created",
        source: "ui",
        actor: { kind: "user", id: "anna" },
        matterId: "m1",
        payload: { matterNumber: "2026-0001" },
      });
      const today = new Date();
      const path = `events/${today.getUTCFullYear()}/${String(today.getUTCMonth() + 1).padStart(2, "0")}/${String(today.getUTCDate()).padStart(2, "0")}.jsonl`;
      expect(await fs.exists(path)).toBe(true);
    });
  });
});
