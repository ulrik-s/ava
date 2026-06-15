/**
 * Test för preloadAllDocuments — demo-läges förladdning av dokumentbinärer
 * från GH Pages till FSA-mappen. Verifierar manifest→meta→binär-flödet,
 * idempotens (skippar befintliga), fel-räkning och progress-callback.
 *
 * Använder fake-FSA + injicerad fetch (modulen tar `fetchFn`).
 */

import { describe, it, expect, vi } from "vitest-compat";
import { preloadAllDocuments } from "@/lib/client/fsa/preload-documents";
import { makeFakeFsa } from "../../../helpers/fake-fsa";

const BASE = "https://example.github.io/ava";

/** Response-lik stub. */
function res(body: { json?: unknown; bytes?: Uint8Array; ok?: boolean }): Response {
  return {
    ok: body.ok ?? true,
    status: body.ok === false ? 404 : 200,
    json: async () => body.json,
    arrayBuffer: async () => (body.bytes ?? new Uint8Array([1, 2, 3])).buffer,
  } as unknown as Response;
}

/** Routar fetch per URL-suffix; binärfiler default-OK med 3 bytes. */
function makeFetch(overrides: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string | URL): Promise<Response> => {
    const u = String(url);
    for (const [suffix, fn] of Object.entries(overrides)) {
      if (u.endsWith(suffix)) return fn();
    }
    if (u.endsWith("manifest.json")) {
      return res({ json: { paths: ["documents/d1.json", "documents/d2.json", "other/skip.json"] } });
    }
    if (u.endsWith("d1.json")) return res({ json: { storagePath: "documents/content/d1.pdf" } });
    if (u.endsWith("d2.json")) return res({ json: { storagePath: "documents/content/d2.pdf" } });
    return res({ bytes: new Uint8Array([9, 9, 9]) }); // binärer
  });
}

describe("preloadAllDocuments", () => {
  it("laddar ner alla binärer från manifestets documents/-metadata", async () => {
    const fsa = makeFakeFsa();
    const r = await preloadAllDocuments({ root: fsa.root, baseUrl: BASE, fetchFn: makeFetch() });
    expect(r).toEqual({ downloaded: 2, skipped: 0, failed: 0 });
    expect(fsa.readFile("documents/content/d1.pdf")).not.toBeNull();
    expect(fsa.readFile("documents/content/d2.pdf")).not.toBeNull();
  });

  it("är idempotent — andra körningen skippar befintliga filer", async () => {
    const fsa = makeFakeFsa();
    await preloadAllDocuments({ root: fsa.root, baseUrl: BASE, fetchFn: makeFetch() });
    const r2 = await preloadAllDocuments({ root: fsa.root, baseUrl: BASE, fetchFn: makeFetch() });
    expect(r2).toEqual({ downloaded: 0, skipped: 2, failed: 0 });
  });

  it("räknar nedladdningsfel utan att avbryta (binär 404 → failed)", async () => {
    const fsa = makeFakeFsa();
    const fetchFn = makeFetch({ "d2.pdf": () => res({ ok: false }) });
    const r = await preloadAllDocuments({ root: fsa.root, baseUrl: BASE, fetchFn });
    expect(r.downloaded).toBe(1);
    expect(r.failed).toBe(1);
  });

  it("hoppar tyst över metadata-filer som inte går att hämta", async () => {
    const fsa = makeFakeFsa();
    const fetchFn = makeFetch({ "d2.json": () => res({ ok: false }) });
    const r = await preloadAllDocuments({ root: fsa.root, baseUrl: BASE, fetchFn });
    // d2:s storagePath samlas aldrig in → bara d1 laddas ner
    expect(r.downloaded).toBe(1);
    expect(r.skipped + r.failed).toBe(0);
  });

  it("kastar om manifestet inte kan hämtas", async () => {
    const fsa = makeFakeFsa();
    const fetchFn = makeFetch({ "manifest.json": () => res({ ok: false }) });
    await expect(preloadAllDocuments({ root: fsa.root, baseUrl: BASE, fetchFn })).rejects.toThrow(/manifest/);
  });

  it("trim:ar trailing slash i baseUrl och anropar onProgress per fil", async () => {
    const fsa = makeFakeFsa();
    const onProgress = vi.fn();
    const r = await preloadAllDocuments({ root: fsa.root, baseUrl: `${BASE}/`, fetchFn: makeFetch(), onProgress });
    expect(r.downloaded).toBe(2);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(2, 2, expect.any(String));
  });

  it("tomt manifest → inga nedladdningar", async () => {
    const fsa = makeFakeFsa();
    const fetchFn = makeFetch({ "manifest.json": () => res({ json: { paths: [] } }) });
    const r = await preloadAllDocuments({ root: fsa.root, baseUrl: BASE, fetchFn });
    expect(r).toEqual({ downloaded: 0, skipped: 0, failed: 0 });
  });
});
