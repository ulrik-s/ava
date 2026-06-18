/**
 * Tester för byte-synk-orkestreringen (#518, ADR 0023) — `runContentSync`.
 * Dep-injicerad, ingen IndexedDB/tRPC: verifierar dedup (hoppa sha:n servern
 * har), upload av saknade, markUploaded alltid, samt no-op vid tom pending.
 */

import { describe, expect, it, vi } from "vitest-compat";
import { runContentSync } from "@/lib/client/backend/content-sync";
import { contentStoragePath } from "@/lib/shared/content-address";

describe("runContentSync", () => {
  it("tom pending → no-op", async () => {
    const upload = vi.fn();
    const out = await runContentSync({
      pending: async () => [], missing: async () => [], getBytes: async () => null, upload, markUploaded: vi.fn(),
    });
    expect(out).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("laddar bara upp sha:n servern saknar (dedup) + markUploaded för alla", async () => {
    const pending = [
      { documentId: "d1", sha: "aaa" },
      { documentId: "d2", sha: "bbb" }, // servern har redan denna
    ];
    const upload = vi.fn(async () => {});
    const markUploaded = vi.fn(async () => {});
    const out = await runContentSync({
      pending: async () => pending,
      missing: async () => [contentStoragePath("aaa")], // bara aaa saknas
      getBytes: async (sha) => new Uint8Array([sha === "aaa" ? 1 : 2]),
      upload,
      markUploaded,
    });
    expect(out).toEqual(["aaa"]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith("d1", new Uint8Array([1]));
    expect(markUploaded).toHaveBeenCalledTimes(2); // båda rensas ur pending
  });

  it("saknad blob (getBytes null) → hoppa upload men markUploaded", async () => {
    const upload = vi.fn(async () => {});
    const markUploaded = vi.fn(async () => {});
    const out = await runContentSync({
      pending: async () => [{ documentId: "d1", sha: "ccc" }],
      missing: async () => [contentStoragePath("ccc")],
      getBytes: async () => null,
      upload,
      markUploaded,
    });
    expect(out).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
    expect(markUploaded).toHaveBeenCalledWith("d1");
  });
});
