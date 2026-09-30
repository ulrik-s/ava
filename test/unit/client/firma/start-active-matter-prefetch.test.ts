/**
 * Start av förladdningen (#1244): sparad text fyller sökningen direkt, och
 * förladdningen körs vid start och efter varje synk — aldrig två samtidigt.
 */
import { describe, expect, it, vi } from "vitest-compat";
import { documentsOf, mattersOf, startActiveMatterPrefetch, type StartActiveMatterPrefetchDeps } from "@/lib/client/firma/start-active-matter-prefetch";

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

function setup(over: Partial<StartActiveMatterPrefetchDeps> = {}) {
  let synced: () => void = () => {};
  const loadBlob = vi.fn(async () => new Blob(["x"]));
  const published: Array<[string, string]> = [];
  const unsubscribe = vi.fn();
  const deps: StartActiveMatterPrefetchDeps = {
    userId: "me",
    source: () => ({
      matters: [{ id: "m1", responsibleLawyerId: "me", status: "ACTIVE" }],
      documents: [{ id: "d1", matterId: "m1", fileName: "a.pdf" }],
    }),
    loadBlob,
    texts: { has: async () => false, put: async () => undefined, loadAll: async () => [["old", "sparad text"]] },
    extract: async () => "text",
    publish: (id, t) => published.push([id, t]),
    onSynced: (fn) => { synced = fn; return unsubscribe; },
    ...over,
  };
  return { deps, loadBlob, published, unsubscribe, synced: () => synced() };
}

describe("startActiveMatterPrefetch", () => {
  it("publicerar sparad text och förladdar vid start", async () => {
    const s = setup();
    startActiveMatterPrefetch(s.deps);
    await flush();
    expect(s.published).toEqual([["old", "sparad text"], ["d1", "text"]]);
    expect(s.loadBlob).toHaveBeenCalledTimes(1);
  });

  it("kör igen efter en synk, men inte medan en körning pågår", async () => {
    let release: () => void = () => {};
    const gate = new Promise<Blob>((r) => { release = () => r(new Blob(["x"])); });
    const s = setup({ loadBlob: vi.fn(() => gate) });
    startActiveMatterPrefetch(s.deps);
    await flush();
    s.synced();
    expect(s.deps.loadBlob).toHaveBeenCalledTimes(1);
    release();
    await flush();
    s.synced();
    await flush();
    expect(s.deps.loadBlob).toHaveBeenCalledTimes(2);
  });

  it("ett fel i sparad text eller i textlagret stoppar inte förladdningen", async () => {
    const s = setup({
      texts: { has: async () => { throw new Error("idb"); }, put: async () => undefined, loadAll: async () => { throw new Error("idb"); } },
    });
    startActiveMatterPrefetch(s.deps);
    await flush();
    expect(s.loadBlob).toHaveBeenCalledTimes(1);
  });

  it("ett fel när storen läses loggas, och nästa synk försöker igen", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let fail = true;
    const s = setup({ source: () => { if (fail) throw new Error("store"); return { matters: [], documents: [] }; } });
    startActiveMatterPrefetch(s.deps);
    await flush();
    expect(warn).toHaveBeenCalledWith("[förladdning] aktiva ärenden:", expect.any(Error));
    fail = false;
    s.synced();
    await flush();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("stoppfunktionen avslutar prenumerationen på synken", () => {
    const s = setup();
    startActiveMatterPrefetch(s.deps)();
    expect(s.unsubscribe).toHaveBeenCalled();
  });
});

describe("storens rader", () => {
  it("ärenden: id krävs, status och ansvarig följer med", () => {
    expect(mattersOf({ matters: [{ id: "m1", responsibleLawyerId: "me", status: "ACTIVE" }, { id: "m2" }, { title: "utan id" }] }))
      .toEqual([{ id: "m1", responsibleLawyerId: "me", status: "ACTIVE" }, { id: "m2", responsibleLawyerId: null }]);
    expect(mattersOf({})).toEqual([]);
  });

  it("dokument: id och ärende krävs; filnamnet faller tillbaka på id:t", () => {
    expect(documentsOf({ documents: [{ id: "d1", matterId: "m1" }, { id: "d2" }, { matterId: "m1" }] }))
      .toEqual([{ id: "d1", matterId: "m1", storagePath: null, fileName: "d1", mimeType: null }]);
    expect(documentsOf({})).toEqual([]);
  });
});
