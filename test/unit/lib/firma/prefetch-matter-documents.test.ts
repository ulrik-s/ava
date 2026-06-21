/**
 * prefetchMatterDocuments (ADR 0028 §4a) — eager-cacha ärendets dokument-bytes.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { prefetchMatterDocuments } from "@/lib/client/firma/prefetch-matter-documents";

const docs = [
  { id: "1", storagePath: "documents/content/a", fileName: "a.pdf" },
  { id: "2", storagePath: null, fileName: "b.docx" },
  { id: "3" },
];

describe("prefetchMatterDocuments", () => {
  it("laddar varje dokument och räknar cachade", async () => {
    const seen: string[] = [];
    const loadBlob = vi.fn(async (d: { id: string }) => { seen.push(d.id); return new Blob(["x"]); });
    const n = await prefetchMatterDocuments(docs, loadBlob);
    expect(n).toBe(3);
    expect(seen.sort()).toEqual(["1", "2", "3"]);
  });

  it("normaliserar saknad storagePath/fileName", async () => {
    const calls: Array<{ id: string; storagePath: string | null; fileName: string }> = [];
    await prefetchMatterDocuments(docs, async (d) => { calls.push(d); return new Blob(["x"]); });
    expect(calls.find((c) => c.id === "2")).toMatchObject({ storagePath: null, fileName: "b.docx" });
    expect(calls.find((c) => c.id === "3")).toMatchObject({ storagePath: null, fileName: "3" }); // fileName→id
  });

  it("är best-effort: ett fel stoppar inte de andra", async () => {
    const loadBlob = vi.fn(async (d: { id: string }) => {
      if (d.id === "2") throw new Error("download failed");
      return new Blob(["x"]);
    });
    const n = await prefetchMatterDocuments(docs, loadBlob);
    expect(n).toBe(2); // 1 och 3 lyckades, 2 svaldes
  });

  it("räknar bara faktiskt cachade (null = miss)", async () => {
    const n = await prefetchMatterDocuments(docs, async (d) => (d.id === "1" ? new Blob(["x"]) : null));
    expect(n).toBe(1);
  });

  it("respekterar concurrency-taket (aldrig fler samtidiga än gränsen)", async () => {
    let active = 0;
    let peak = 0;
    const many = Array.from({ length: 10 }, (_v, i) => ({ id: String(i) }));
    await prefetchMatterDocuments(many, async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Blob(["x"]);
    }, 3);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("tom lista → 0, inga anrop", async () => {
    const loadBlob = vi.fn(async () => new Blob(["x"]));
    expect(await prefetchMatterDocuments([], loadBlob)).toBe(0);
    expect(loadBlob).not.toHaveBeenCalled();
  });
});
