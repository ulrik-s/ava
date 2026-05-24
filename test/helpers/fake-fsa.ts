/**
 * In-memory FSA-mock — implementerar tillräcklig del av File System
 * Access API:t för att exercise:a `FsaIsoGitAdapter`, `walkFsa`,
 * `makeFsaWriteBack` och `uploadDocumentToFsa` end-to-end i tester.
 *
 * Returnerar både root-handle:n och en read-helper så assertions kan
 * verifiera vad som faktiskt skrevs på "disk".
 */

export type FsNode =
  | { kind: "file"; bytes: Uint8Array; lastModified: number }
  | { kind: "dir"; children: Map<string, FsNode> };

export interface FakeFsa {
  root: FileSystemDirectoryHandle;
  tree: Extract<FsNode, { kind: "dir" }>;
  /** Slå upp file-bytes på en path, eller null om saknas. */
  readFile(path: string): Uint8Array | null;
  /** Är en path en existerande directory? */
  hasDir(path: string): boolean;
  /** Lista alla file-paths i hela trädet. */
  listAllFiles(): string[];
}

function makeFileMock(node: Extract<FsNode, { kind: "file" }>, name: string): FileSystemFileHandle {
  return {
    // FSA-spec använder "file" / "directory" på handles — INTE fsNode-typen
    kind: "file" as const,
    name,
    async getFile() {
      const part = node.bytes as unknown as BlobPart;
      return new File([part], name, { lastModified: node.lastModified, type: "application/octet-stream" });
    },
    async createWritable() {
      const chunks: Uint8Array[] = [];
      return {
        async write(data: unknown) {
          // FSA tar emot flera typer: Uint8Array, ArrayBuffer, ArrayBufferView,
          // Blob, string. Vi hanterar de vanligaste här så testen kan
          // exercise:a samma writeFile-väg som riktig FSA.
          if (data instanceof Uint8Array) {
            chunks.push(data);
          } else if (data instanceof ArrayBuffer) {
            chunks.push(new Uint8Array(data));
          } else if (ArrayBuffer.isView(data)) {
            const view = data as ArrayBufferView;
            chunks.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
          } else if (typeof data === "string") {
            chunks.push(new TextEncoder().encode(data));
          } else if (data && typeof (data as Blob).arrayBuffer === "function") {
            chunks.push(new Uint8Array(await (data as Blob).arrayBuffer()));
          } else {
            throw new Error(`Fake-FSA writable.write: oväntad data-typ ${typeof data}`);
          }
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

function makeDirMock(node: Extract<FsNode, { kind: "dir" }>, name: string): FileSystemDirectoryHandle {
  const dir = {
    // FSA-spec: handles har kind "directory" (inte "dir" som fsNode-typen).
    kind: "directory" as const,
    name,
    async getFileHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child) {
        if (!opts?.create) throw new Error(`not found: ${n}`);
        child = { kind: "file", bytes: new Uint8Array(), lastModified: Date.now() };
        node.children.set(n, child);
      }
      if (child.kind !== "file") throw new Error(`not a file: ${n}`);
      return makeFileMock(child, n);
    },
    async getDirectoryHandle(n: string, opts?: { create?: boolean }) {
      let child = node.children.get(n);
      if (!child) {
        if (!opts?.create) throw new Error(`not found: ${n}`);
        child = { kind: "dir", children: new Map() };
        node.children.set(n, child);
      }
      if (child.kind !== "dir") throw new Error(`not a dir: ${n}`);
      return makeDirMock(child, n);
    },
    async removeEntry(n: string) {
      node.children.delete(n);
    },
    async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
      for (const [k, v] of node.children) {
        const handle = v.kind === "file" ? makeFileMock(v, k) : makeDirMock(v, k);
        yield [k, handle];
      }
    },
    async *values(): AsyncIterableIterator<FileSystemHandle> {
      for (const [k, v] of node.children) {
        yield v.kind === "file" ? makeFileMock(v, k) : makeDirMock(v, k);
      }
    },
    async *keys(): AsyncIterableIterator<string> {
      for (const k of node.children.keys()) yield k;
    },
    async queryPermission() { return "granted"; },
    async requestPermission() { return "granted"; },
  };
  // Symbol.asyncIterator → default = entries() (per FSA-spec)
  (dir as unknown as { [Symbol.asyncIterator]: () => AsyncIterableIterator<[string, FileSystemHandle]> })[Symbol.asyncIterator] = dir.entries;
  return dir as unknown as FileSystemDirectoryHandle;
}

function splitPath(p: string): string[] {
  return p.split("/").filter((s) => s.length > 0);
}

function lookup(tree: Extract<FsNode, { kind: "dir" }>, path: string): FsNode | null {
  const parts = splitPath(path);
  let cur: FsNode = tree;
  for (const p of parts) {
    if (cur.kind !== "dir") return null;
    const next = cur.children.get(p);
    if (!next) return null;
    cur = next;
  }
  return cur;
}

function listFiles(node: FsNode, prefix: string, out: string[]): void {
  if (node.kind === "file") { out.push(prefix.replace(/^\//, "")); return; }
  for (const [k, v] of node.children) listFiles(v, `${prefix}/${k}`, out);
}

export function makeFakeFsa(): FakeFsa {
  const tree: Extract<FsNode, { kind: "dir" }> = { kind: "dir", children: new Map() };
  const root = makeDirMock(tree, "root");
  return {
    root,
    tree,
    readFile(path) {
      const node = lookup(tree, path);
      return node?.kind === "file" ? node.bytes : null;
    },
    hasDir(path) {
      const node = lookup(tree, path);
      return node?.kind === "dir";
    },
    listAllFiles() {
      const out: string[] = [];
      listFiles(tree, "", out);
      return out;
    },
  };
}
