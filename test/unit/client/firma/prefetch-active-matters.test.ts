/**
 * Förladdningen av juristens aktiva ärenden (#1244).
 */
import { describe, expect, it, vi } from "vitest-compat";
import { type ActiveMatterPrefetchDeps, prefetchActiveMatters } from "@/lib/client/firma/prefetch-active-matters";
import { asId } from "@/lib/shared/schemas/ids";

const doc = (id: string, matterId: string, mimeType: string | null = "application/pdf") =>
  ({ id: asId<"DocumentId">(id), matterId, storagePath: `documents/${id}`, fileName: `${id}.pdf`, mimeType });

function deps(over: Partial<ActiveMatterPrefetchDeps> = {}) {
  const stored = new Map<string, string>();
  const published: Array<[string, string]> = [];
  const loaded: string[] = [];
  const base: ActiveMatterPrefetchDeps = {
    userId: "me",
    matters: [
      { id: "mine", responsibleLawyerId: "me", status: "ACTIVE" },
      { id: "closed", responsibleLawyerId: "me", status: "CLOSED" },
      { id: "theirs", responsibleLawyerId: "bo", status: "ACTIVE" },
    ],
    documents: [doc("d1", "mine"), doc("d2", "closed"), doc("d3", "theirs"), doc("d4", "mine", null)],
    loadBlob: async (d) => { loaded.push(d.id); return new Blob(["x"]); },
    texts: { has: async (id) => stored.has(id), put: async (id, t) => { stored.set(id, t); } },
    extract: async ({ fileName }) => `text i ${fileName}`,
    publish: (id, t) => published.push([id, t]),
    ...over,
  };
  return { base, stored, published, loaded };
}

describe("prefetchActiveMatters", () => {
  it("hämtar och indexerar bara juristens egna, aktiva ärenden", async () => {
    const { base, stored, published, loaded } = deps();
    expect(await prefetchActiveMatters(base)).toEqual({ matters: 1, cached: 2, indexed: 2 });
    expect(loaded.sort()).toEqual(["d1", "d4"]);
    expect([...stored.keys()].sort()).toEqual(["d1", "d4"]);
    expect(published).toContainEqual(["d1", "text i d1.pdf"]);
  });

  it("mime-typen följer med till extraheringen när den är känd", async () => {
    const extract = vi.fn(async () => "t");
    await prefetchActiveMatters(deps({ extract }).base);
    expect(extract).toHaveBeenCalledWith(expect.objectContaining({ fileName: "d1.pdf", mimeType: "application/pdf" }));
    expect(extract).toHaveBeenCalledWith(expect.not.objectContaining({ mimeType: expect.anything() }));
  });

  it("text som redan finns extraheras inte igen", async () => {
    const extract = vi.fn(async () => "t");
    const { base, stored } = deps({ extract });
    stored.set("d1", "gammal");
    stored.set("d4", "gammal");
    expect(await prefetchActiveMatters(base)).toMatchObject({ cached: 2, indexed: 0 });
    expect(extract).not.toHaveBeenCalled();
  });

  it("ett dokument som inte gick att hämta, eller saknar text, indexeras inte", async () => {
    const { base, stored } = deps({
      loadBlob: async (d) => (d.id === "d1" ? null : new Blob(["x"])),
      extract: async () => "   ",
    });
    expect(await prefetchActiveMatters(base)).toEqual({ matters: 1, cached: 1, indexed: 0 });
    expect(stored.size).toBe(0);
  });
});
