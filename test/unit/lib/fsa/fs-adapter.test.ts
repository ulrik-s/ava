/**
 * Tester för `FsaIsoGitAdapter` — wrappar FileSystemDirectoryHandle
 * som Node-fs-API för isomorphic-git.
 *
 * Vi mock:ar FSA-API:et genom ett minimal in-memory tree.
 */

import { describe, it, expect } from "vitest";
import { FsaIsoGitAdapter } from "@/lib/client/fsa/fs-adapter";

// ─── In-memory FSA-mock ────────────────────────────────────────────

type Node = { kind: "file"; bytes: Uint8Array; lastModified: number } | { kind: "dir"; children: Map<string, Node> };

function makeFileMock(node: Extract<Node, { kind: "file" }>): FileSystemFileHandle {
  return {
    kind: "file",
    name: "file",
    async getFile() {
      // Casta via BlobPart för att undvika TS2322 om Uint8Array's
      // ArrayBufferLike vs ArrayBuffer.
      const part = node.bytes as unknown as BlobPart;
      return new File([part], "file", { lastModified: node.lastModified, type: "application/octet-stream" });
    },
    async createWritable() {
      const chunks: Uint8Array[] = [];
      return {
        async write(data: Uint8Array | { type: string; data?: Uint8Array }) {
          if (data instanceof Uint8Array) chunks.push(data);
        },
        async close() {
          const total = chunks.reduce((sum, c) => sum + c.length, 0);
          const out = new Uint8Array(total);
          let off = 0;
          for (const c of chunks) { out.set(c, off); off += c.length; }
          node.bytes = out;
          node.lastModified = Date.now();
        },
      } as unknown as FileSystemWritableFileStream;
    },
  } as unknown as FileSystemFileHandle;
}

function makeDirMock(node: Extract<Node, { kind: "dir" }>, name: string): FileSystemDirectoryHandle {
  const dir = {
    kind: "dir",
    name,
    async getFileHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child) {
        if (!opts?.create) throw new Error("not found");
        child = { kind: "file", bytes: new Uint8Array(), lastModified: Date.now() };
        node.children.set(n, child);
      }
      if (child.kind !== "file") throw new Error("not a file");
      return makeFileMock(child);
    },
    async getDirectoryHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child) {
        if (!opts?.create) throw new Error("not found");
        child = { kind: "dir", children: new Map() };
        node.children.set(n, child);
      }
      if (child.kind !== "dir") throw new Error("not a dir");
      return makeDirMock(child, n);
    },
    async removeEntry(n: string, _opts?: { recursive?: boolean }) {
      node.children.delete(n);
    },
    async *entries() {
      for (const [k] of node.children) yield [k, null] as never;
    },
  };
  return dir as unknown as FileSystemDirectoryHandle;
}

function makeRoot(): { root: FileSystemDirectoryHandle; tree: Extract<Node, { kind: "dir" }> } {
  const tree: Extract<Node, { kind: "dir" }> = { kind: "dir", children: new Map() };
  return { root: makeDirMock(tree, "root"), tree };
}

// ─── Tester ────────────────────────────────────────────────────────

describe("FsaIsoGitAdapter", () => {
  it("stat på root '/' returnerar dir-stat", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    const s = await fs.stat("/");
    expect(s.isDirectory()).toBe(true);
    expect(s.isFile()).toBe(false);
  });

  it("stat på '.' (current dir) returnerar dir-stat", async () => {
    // Regression: isomorphic-git anropar lstat('.') vid statusMatrix.
    // Tidigare kraschade detta med ENOENT eftersom '.' tolkades som
    // ett bokstavligt filnamn.
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    const s = await fs.stat(".");
    expect(s.isDirectory()).toBe(true);
  });

  it("lstat på '.' returnerar dir-stat (= stat)", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    const s = await fs.lstat(".");
    expect(s.isDirectory()).toBe(true);
  });

  it("stat på '' returnerar dir-stat", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    const s = await fs.stat("");
    expect(s.isDirectory()).toBe(true);
  });

  it("writeFile + readFile round-trip", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    await fs.writeFile("/hello.txt", "Hej världen");
    const content = await fs.readFile("/hello.txt", "utf8");
    expect(content).toBe("Hej världen");
  });

  it("writeFile skapar parent-dirs rekursivt", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    await fs.writeFile("/contacts/c1.json", '{"id":"c1"}');
    const c = await fs.readFile("/contacts/c1.json", "utf8");
    expect(c).toBe('{"id":"c1"}');
  });

  it("readFile på saknad fil → ENOENT", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    await expect(fs.readFile("/missing.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stat på saknad fil → ENOENT", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    await expect(fs.stat("/missing.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("unlink tar bort fil", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    await fs.writeFile("/x.txt", "data");
    await fs.unlink("/x.txt");
    await expect(fs.readFile("/x.txt")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("readdir listar entries", async () => {
    const { root } = makeRoot();
    const fs = new FsaIsoGitAdapter(root);
    await fs.writeFile("/a.txt", "1");
    await fs.writeFile("/b.txt", "2");
    const names = await fs.readdir("/");
    expect(names.sort()).toEqual(["a.txt", "b.txt"]);
  });
});
