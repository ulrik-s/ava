/**
 * Servern klassar ett dokument vars innehåll kom via synken (#1156).
 *
 * I self-hosted körs `uploadContent` i klienten; servern får den nya
 * `storagePath` i en synkad rad och bytes:en via byte-synken — men bara om den
 * inte redan har dem (dedup på sha). Samma PDF uppladdad en gång till fick
 * därför aldrig någon klassning av servern, bara klientens (tomma) gissning.
 * Nu: en accepterad dokumentrad med nytt innehåll som servern redan har →
 * servern köar klassificeringen själv.
 */
import { describe, expect, it } from "vitest-compat";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { PushResult } from "@/lib/server/data-store/in-memory/sync-transport";
import { analyzeIfNewContent, type DocumentPathReader, storagePathBefore } from "@/lib/server/sync/classify-new-content";

const ID = "0190a1b2-0000-7000-8000-00000000d001";
const NEW = "documents/content/aaaa";
const OLD = "documents/content/bbbb";

function harness(existing: readonly string[] = [NEW]) {
  const analyzed: string[] = [];
  const deps = {
    content: { exists: async (p: string) => existing.includes(p) },
    analyzer: { analyze: async (id: string) => { analyzed.push(id); } },
  };
  return { deps, analyzed };
}

const mutation = (over: Partial<QueuedMutation> = {}): QueuedMutation => ({
  mutationId: "m", entity: "document", kind: "update", enqueuedAt: 0, row: { id: ID, storagePath: NEW }, ...over,
});
const accepted = (row: Record<string, unknown> = { id: ID, storagePath: NEW }): PushResult => ({ status: "accepted", row });

describe("analyzeIfNewContent", () => {
  it("nytt innehåll som servern redan har → klassas av servern", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation(), OLD, accepted());
    expect(h.analyzed).toEqual([ID]);
  });

  it("ny rad (create) med innehåll som servern har → klassas", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation({ kind: "create" }), null, accepted());
    expect(h.analyzed).toEqual([ID]);
  });

  it("också när servern ombaserade raden (rebased)", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation(), OLD, { status: "rebased", row: { id: ID, storagePath: NEW } });
    expect(h.analyzed).toEqual([ID]);
  });

  it("innehållet saknas ännu → inget (uploadContent klassar när bytes:en kommer)", async () => {
    const h = harness([]);
    await analyzeIfNewContent(h.deps, mutation(), OLD, accepted());
    expect(h.analyzed).toEqual([]);
  });

  it("oförändrad storagePath (t.ex. namnbyte) → ingen omklassning", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation(), NEW, accepted());
    expect(h.analyzed).toEqual([]);
  });

  it("konflikt → inget", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation(), OLD, { status: "conflict", reason: "stale" });
    expect(h.analyzed).toEqual([]);
  });

  it("radering → inget", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation({ kind: "delete" }), OLD, accepted());
    expect(h.analyzed).toEqual([]);
  });

  it("annan entitet → inget", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation({ entity: "contact" }), OLD, accepted());
    expect(h.analyzed).toEqual([]);
  });

  it("rad utan storagePath → inget", async () => {
    const h = harness();
    await analyzeIfNewContent(h.deps, mutation(), OLD, accepted({ id: ID }));
    expect(h.analyzed).toEqual([]);
  });

  it("ett fel i köandet fäller inte synken (klassningen kan köras om)", async () => {
    const h = harness();
    const failing = { ...h.deps, analyzer: { analyze: async () => { throw new Error("kön nere"); } } };
    await expect(analyzeIfNewContent(failing, mutation(), OLD, accepted())).resolves.toBeUndefined();
  });
});

describe("storagePathBefore", () => {
  const repos = (row: { storagePath: string } | null): DocumentPathReader => ({ documents: { getById: async () => row } });
  it("befintligt dokument → dess storagePath", async () => {
    expect(await storagePathBefore(repos({ storagePath: OLD }), mutation())).toBe(OLD);
  });
  it("nytt dokument → null", async () => {
    expect(await storagePathBefore(repos(null), mutation({ kind: "create" }))).toBeNull();
  });
  it("inte ett dokument, eller en radering → undefined (inget läses)", async () => {
    expect(await storagePathBefore(repos({ storagePath: OLD }), mutation({ entity: "contact" }))).toBeUndefined();
    expect(await storagePathBefore(repos({ storagePath: OLD }), mutation({ kind: "delete" }))).toBeUndefined();
  });
  it("rad utan id → undefined", async () => {
    expect(await storagePathBefore(repos({ storagePath: OLD }), mutation({ row: { storagePath: NEW } }))).toBeUndefined();
  });
});
