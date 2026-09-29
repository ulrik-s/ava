/**
 * Integritetskontrollen (#1145) — dokument med metadata men utan innehåll på
 * servern ska synas i loggen (level error), inte upptäckas av användaren.
 */
import { describe, expect, it, vi } from "vitest-compat";
import {
  checkContentIntegrity,
  DEFAULT_MIN_AGE_MS,
  runContentIntegrityCheck,
  scheduleContentIntegrity,
} from "@/lib/server/integrity/content-integrity";
import type { StoredContentRow } from "@/lib/server/repositories/document-repository";
import { asId } from "@/lib/shared/schemas/ids";

const NOW = new Date("2026-09-30T08:00:00Z");
const OLD = new Date(NOW.getTime() - DEFAULT_MIN_AGE_MS - 1);
const row = (id: string, storagePath: string, createdAt = OLD): StoredContentRow => ({ id: asId<"DocumentId">(id), storagePath, createdAt });

function deps(rows: StoredContentRow[], present: string[]) {
  const exists = vi.fn(async (p: string) => present.includes(p));
  return { deps: { listStoredContent: async () => rows, exists }, exists };
}

describe("checkContentIntegrity", () => {
  it("listar dokument vars innehåll saknas; de som har innehåll är ok", async () => {
    const { deps: d } = deps([row("a", "documents/content/aaa"), row("b", "documents/content/bbb")], ["documents/content/aaa"]);
    expect(await checkContentIntegrity(d, NOW)).toEqual({
      checked: 2, missing: [{ storagePath: "documents/content/bbb", documentIds: ["b"] }], emptyPath: [],
    });
  });

  it("nya dokument räknas inte — bytes:en laddas upp efter raden", async () => {
    const fresh = new Date(NOW.getTime() - 60_000);
    const { deps: d, exists } = deps([row("ny", "documents/content/x", fresh)], []);
    expect(await checkContentIntegrity(d, NOW)).toEqual({ checked: 0, missing: [], emptyPath: [] });
    expect(exists).not.toHaveBeenCalled();
  });

  it("en delad innehållsadress kontrolleras en gång och listar alla dokument som pekar på den", async () => {
    const { deps: d, exists } = deps([row("a", "documents/content/sha"), row("b", "documents/content/sha")], []);
    expect((await checkContentIntegrity(d, NOW)).missing).toEqual([{ storagePath: "documents/content/sha", documentIds: ["a", "b"] }]);
    expect(exists).toHaveBeenCalledTimes(1);
  });

  it("en tom adress rapporteras för sig (den har aldrig haft innehåll)", async () => {
    const { deps: d, exists } = deps([row("tom", "")], []);
    expect(await checkContentIntegrity(d, NOW)).toEqual({ checked: 1, missing: [], emptyPath: ["tom"] });
    expect(exists).not.toHaveBeenCalled();
  });
});

describe("runContentIntegrityCheck", () => {
  const logger = () => ({ info: vi.fn(), error: vi.fn() });

  it("saknat innehåll → level error med dokumentens id:n (att larma på)", async () => {
    const log = logger();
    const { deps: d } = deps([row("a", "documents/content/a"), row("tom", ""), row("ok", "documents/content/ok")], ["documents/content/ok"]);
    await runContentIntegrityCheck(d, log, NOW);
    expect(log.error).toHaveBeenCalledWith("content.integrity.missing", { total: 3, count: 2, ids: ["a", "tom"] });
    expect(log.info).not.toHaveBeenCalled();
  });

  it("allt finns → en info-rad (så att man ser att kontrollen körde)", async () => {
    const log = logger();
    const { deps: d } = deps([row("ok", "documents/content/ok")], ["documents/content/ok"]);
    await runContentIntegrityCheck(d, log, NOW);
    expect(log.info).toHaveBeenCalledWith("content.integrity.ok", { total: 1, count: 0 });
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("scheduleContentIntegrity", () => {
  it("kör direkt och sedan periodiskt; stopp rensar timern", async () => {
    const run = vi.fn(async () => undefined);
    let tick: () => void = () => {};
    const clearTimer = vi.fn();
    const stop = scheduleContentIntegrity({
      run, intervalMs: 1000,
      setTimer: (fn, ms) => { tick = fn; expect(ms).toBe(1000); return 7; },
      clearTimer,
    });
    expect(run).toHaveBeenCalledTimes(1);
    tick();
    expect(run).toHaveBeenCalledTimes(2);
    stop();
    expect(clearTimer).toHaveBeenCalledWith(7);
  });

  it("en kontroll som kastar tar inte ned processen", async () => {
    const run = vi.fn(async () => { throw new Error("db nere"); });
    const stop = scheduleContentIntegrity({ run, intervalMs: 1000, setTimer: () => 1, clearTimer: () => {} });
    await Promise.resolve();
    expect(run).toHaveBeenCalledTimes(1);
    stop();
  });

  it("standardtimern är setInterval/clearInterval", () => {
    const stop = scheduleContentIntegrity({ run: async () => undefined, intervalMs: 60_000 });
    stop();
  });
});
