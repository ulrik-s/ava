/**
 * Tester för `downloadToFsa`. Mockar fetch + bygger en fake FSA-root
 * som ackumulerar skrivna filer i en Map. Bevisar:
 *   1. Nedladdning skapar saknade kataloger.
 *   2. Bytes från fetch landar i createWritable → write → close.
 *   3. HTTP-fel kastar med tydligt meddelande.
 */

import { describe, it, expect, vi } from "vitest";
import { downloadToFsa } from "@/lib/client/fsa/download-to-fsa";

// ── Minimal FSA-fake ─────────────────────────────────────────────────

class FakeWritable {
  bytes: Uint8Array | null = null;
  closed = false;
   
  async write(b: Uint8Array): Promise<void> { this.bytes = b; }
   
  async close(): Promise<void> { this.closed = true; }
}

class FakeFileHandle {
  writable = new FakeWritable();
   
  async createWritable(): Promise<FakeWritable> { return this.writable; }
}

class FakeDirHandle {
  name: string;
  files = new Map<string, FakeFileHandle>();
  dirs = new Map<string, FakeDirHandle>();
  constructor(name = "root") { this.name = name; }
   
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDirHandle> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts?.create) throw new Error("not-found");
      d = new FakeDirHandle(name);
      this.dirs.set(name, d);
    }
    return d;
  }
   
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFileHandle> {
    let f = this.files.get(name);
    if (!f) {
      if (!opts?.create) throw new Error("not-found");
      f = new FakeFileHandle();
      this.files.set(name, f);
    }
    return f;
  }
}

function mockFetch(bytes: Uint8Array, ok = true, status = 200): typeof fetch {
  return vi.fn(async () => ({
    ok, status,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  } as Response)) as typeof fetch;
}

describe("downloadToFsa", () => {
  it("skapar saknade kataloger och skriver bytes", async () => {
    const root = new FakeDirHandle("repo");
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchFn = mockFetch(bytes);

    const result = await downloadToFsa({
      root: root as unknown as FileSystemDirectoryHandle,
      relativePath: "documents/content/doc-001.pdf",
      url: "https://example.com/d.pdf",
      fetchFn,
    });

    expect(result.sizeBytes).toBe(4);
    const docsDir = root.dirs.get("documents")!;
    const contentDir = docsDir.dirs.get("content")!;
    const file = contentDir.files.get("doc-001.pdf")!;
    expect(file.writable.bytes).toEqual(bytes);
    expect(file.writable.closed).toBe(true);
  });

  it("kastar vid HTTP-fel", async () => {
    const root = new FakeDirHandle();
    const fetchFn = mockFetch(new Uint8Array(), false, 404);
    await expect(
      downloadToFsa({ root: root as never, relativePath: "a/b.pdf", url: "x", fetchFn }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it("kastar på tom relativePath", async () => {
    const root = new FakeDirHandle();
    const fetchFn = mockFetch(new Uint8Array());
    await expect(
      downloadToFsa({ root: root as never, relativePath: "", url: "x", fetchFn }),
    ).rejects.toThrow(/tom relativePath/);
  });
});
