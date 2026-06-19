/**
 * `StaticContentStore` (#545, ADR 0025) — IContentStore som serverar bundlade
 * demo-blobbar via fetch. Demon öppnar dokument via samma content-port-söm som
 * server-first (GitContentStore).
 */

import { describe, it, expect, vi } from "vitest-compat";
import { StaticContentStore } from "@/lib/client/backend/static-content-store";
import type { IContentStore } from "@/lib/server/ports";

function res(body: Uint8Array | null): Response {
  if (body === null) return new Response("", { status: 404 });
  return new Response(body as BlobPart, { status: 200 });
}

describe("StaticContentStore", () => {
  it("read() hämtar bytes från <baseUrl>/<storagePath>", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = vi.fn(async () => res(bytes)) as unknown as typeof fetch;
    const store = new StaticContentStore("https://x.io/ava", fetchFn);

    const got = await store.read("documents/content/doc-12.pdf");
    expect(got).toEqual(bytes);
    expect(fetchFn).toHaveBeenCalledWith(
      "https://x.io/ava/documents/content/doc-12.pdf",
      { method: "GET", cache: "no-store" },
    );
  });

  it("read() normaliserar ledande slash i storagePath", async () => {
    const fetchFn = vi.fn(async () => res(new Uint8Array([9]))) as unknown as typeof fetch;
    const store = new StaticContentStore("https://x.io/ava", fetchFn);
    await store.read("/documents/content/x.pdf");
    expect(fetchFn).toHaveBeenCalledWith("https://x.io/ava/documents/content/x.pdf", expect.anything());
  });

  it("read() → null vid 404 (blob saknas)", async () => {
    const fetchFn = vi.fn(async () => res(null)) as unknown as typeof fetch;
    const store = new StaticContentStore("https://x.io/ava", fetchFn);
    expect(await store.read("documents/content/missing.pdf")).toBeNull();
  });

  it("exists() speglar svaret ok/404", async () => {
    const okFetch = vi.fn(async () => res(new Uint8Array([1]))) as unknown as typeof fetch;
    const missFetch = vi.fn(async () => res(null)) as unknown as typeof fetch;
    expect(await new StaticContentStore("b", okFetch).exists("p")).toBe(true);
    expect(await new StaticContentStore("b", missFetch).exists("p")).toBe(false);
  });

  it("write() är no-op (demon laddar aldrig upp)", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const store: IContentStore = new StaticContentStore("b", fetchFn);
    await store.write("p", new Uint8Array([1]));
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
