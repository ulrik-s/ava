/**
 * `MemFs` — backing-store som exponerar BÅDA fronts:
 *
 *   1. `IFileSystem`-yta (`readFile`, `writeFile`, `listDir`, ...)
 *      — för LocalGitStore, ProjectionWriter, etc.
 *
 *   2. `nodeFs()` callback-style API kompatibelt med `isomorphic-git`
 *      — för IsomorphicGitOps i browser/Node.
 *
 * Båda läser från SAMMA Map<path, Buffer> så de ser samma data.
 *
 * Designval:
 *   - **Single responsibility:** ren in-memory storage. Inga semantiska
 *     git-operationer.
 *   - **DRY:** vi återanvänder strukturen från `InMemoryFileSystem` men
 *     håller buffert (inte string) som data så binära filer fungerar
 *     (git-objekt, pack-filer, LFS-pointers).
 *   - **Liskov:** uppfyller `IFileSystem` så LocalGitStore kan inte se
 *     skillnad mellan denna och InMemoryFileSystem.
 *
 * `isomorphic-git` förväntar sig ett objekt med callback-style metoder
 * (`(path, cb)`, `(path, encoding, cb)`). Den här klassen exponerar det
 * via `nodeFs()`.
 */

import type { IFileSystem } from "./file-system";

// ── Minimala typer för isomorphic-git:s fs-yta ────────────────
type NodeCallback<T = void> = (err: Error | null, result?: T) => void;
type StatLike = {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  type: "file" | "dir";
  mode: number;
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  dev: number;
  uid: number;
  gid: number;
};

export interface NodeFsLike {
  readFile(path: string, cb: NodeCallback<Buffer>): void;
  readFile(path: string, encoding: string, cb: NodeCallback<string>): void;
  writeFile(path: string, data: Buffer | string, cb: NodeCallback): void;
  writeFile(path: string, data: Buffer | string, encoding: string, cb: NodeCallback): void;
  unlink(path: string, cb: NodeCallback): void;
  readdir(path: string, cb: NodeCallback<string[]>): void;
  mkdir(path: string, cb: NodeCallback): void;
  rmdir(path: string, cb: NodeCallback): void;
  stat(path: string, cb: NodeCallback<StatLike>): void;
  lstat(path: string, cb: NodeCallback<StatLike>): void;
  /** Modern Node 16+/isomorphic-git föredrar promises-API om det finns. */
  promises: NodeFsPromisesLike;
}

export interface NodeFsPromisesLike {
  readFile(path: string, options?: { encoding?: string } | string): Promise<Buffer | string>;
  writeFile(path: string, data: Buffer | string, options?: { encoding?: string } | string): Promise<void>;
  unlink(path: string): Promise<void>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  stat(path: string): Promise<StatLike>;
  lstat(path: string): Promise<StatLike>;
  readlink(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
}

export class MemFs implements IFileSystem {
  // Map<normalisedPath, Buffer> — UTF-8-friendly via Buffer för text + git-blobs
  private store: Map<string, Buffer> = new Map();

  // ── IFileSystem (used by LocalGitStore, ProjectionWriter) ────

  async readFile(path: string): Promise<string> {
    const buf = this.store.get(this.norm(path));
    if (!buf) throw enoent(path);
    return buf.toString("utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.store.set(this.norm(path), Buffer.from(content, "utf8"));
  }

  async appendFile(path: string, content: string): Promise<void> {
    const key = this.norm(path);
    const prev = this.store.get(key) ?? Buffer.alloc(0);
    this.store.set(key, Buffer.concat([prev, Buffer.from(content, "utf8")]));
  }

  async exists(path: string): Promise<boolean> {
    return this.store.has(this.norm(path));
  }

  async deleteFile(path: string): Promise<void> {
    this.store.delete(this.norm(path));
  }

  /**
   * Producera en JSON-serialiserbar snapshot av hela fs-state.
   * Buffrar encodas som base64 så binär data inte korrumperas vid
   * JSON.stringify/parse. Används av `IPersistence`-backendar.
   */
  snapshot(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [path, buf] of this.store) {
      out[path] = buf.toString("base64");
    }
    return out;
  }

  /**
   * Ersätt all fs-state med innehållet från en tidigare snapshot.
   * `null`/`undefined` är no-op (för "ingen cachad data" fallback).
   */
  restore(snapshot: Record<string, string> | null | undefined): void {
    if (!snapshot) return;
    this.store.clear();
    for (const [path, b64] of Object.entries(snapshot)) {
      this.store.set(path, Buffer.from(b64, "base64"));
    }
  }

  async listDir(prefix: string): Promise<string[]> {
    const norm = this.norm(prefix);
    const search = norm === "" ? "" : `${norm}/`;
    const direct: Set<string> = new Set();
    for (const p of this.store.keys()) {
      if (search !== "" && !p.startsWith(search)) continue;
      const rest = search === "" ? p : p.slice(search.length);
      const firstSlash = rest.indexOf("/");
      direct.add(firstSlash === -1 ? rest : rest.slice(0, firstSlash));
    }
    return Array.from(direct).filter((s) => s !== "");
  }

  // ── nodeFs() — callback-API som isomorphic-git förväntar sig ──

  nodeFs(): NodeFsLike {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- behöver fångas i nested closures för callbacks
    const self = this;
    const promises: NodeFsPromisesLike = {
      async readFile(path: string, options?: { encoding?: string } | string): Promise<Buffer | string> {
        const buf = self.store.get(self.norm(path));
        if (!buf) throw enoent(path);
        const enc = typeof options === "string" ? options : options?.encoding;
        return enc ? buf.toString(enc as BufferEncoding) : buf;
      },
      async writeFile(path: string, data: Buffer | string): Promise<void> {
        const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
        self.store.set(self.norm(path), buf);
      },
      async unlink(path: string): Promise<void> {
        self.store.delete(self.norm(path));
      },
      async readdir(path: string): Promise<string[]> {
        return self.listDir(path);
      },
      async mkdir(): Promise<void> { /* no-op */ },
      async rmdir(): Promise<void> { /* no-op */ },
      async stat(path: string): Promise<StatLike> {
        const norm = self.norm(path);
        // Root och "." räknas alltid som mapp (även när store är tom)
        if (norm === "" || norm === ".") return dirStat();
        if (self.store.has(norm)) return fileStat(self.store.get(norm)!.length);
        const search = `${norm}/`;
        for (const p of self.store.keys()) {
          if (p.startsWith(search)) return dirStat();
        }
        throw enoent(path);
      },
      async lstat(path: string): Promise<StatLike> { return promises.stat(path); },
      // isomorphic-git förväntar sig readlink/symlink även om vi inte
      // stöder länkar. ENOENT signalerar "ingen länk här".
      async readlink(path: string): Promise<string> { throw enoent(path); },
      async symlink(_t: string, p: string): Promise<void> { throw enoent(p); },
    } as NodeFsPromisesLike;
    return {
      promises,
      readFile(path: string, ...rest: unknown[]): void {
        let encoding: string | undefined;
        let cb: NodeCallback<Buffer | string>;
        if (typeof rest[0] === "function") {
          cb = rest[0] as NodeCallback<Buffer | string>;
        } else {
          encoding = rest[0] as string;
          cb = rest[1] as NodeCallback<Buffer | string>;
        }
        const buf = self.store.get(self.norm(path));
        if (!buf) return cb(enoent(path));
        cb(null, encoding ? buf.toString(encoding as BufferEncoding) : buf);
      },
      writeFile(path: string, data: Buffer | string, ...rest: unknown[]): void {
        const cb = typeof rest[0] === "function"
          ? rest[0] as NodeCallback
          : rest[1] as NodeCallback;
        const buf = typeof data === "string" ? Buffer.from(data, "utf8") : data;
        self.store.set(self.norm(path), buf);
        cb(null);
      },
      unlink(path: string, cb: NodeCallback): void {
        self.store.delete(self.norm(path));
        cb(null);
      },
      readdir(path: string, cb: NodeCallback<string[]>): void {
        void self.listDir(path).then(
          (entries) => cb(null, entries),
          (err) => cb(err as Error),
        );
      },
      mkdir(_path: string, cb: NodeCallback): void {
        // No-op: vi har inga riktiga mappar i Map-backenden — paths
        // skapas implicit vid writeFile.
        cb(null);
      },
      rmdir(_path: string, cb: NodeCallback): void {
        cb(null);
      },
      stat(path: string, cb: NodeCallback<StatLike>): void {
        const norm = self.norm(path);
        if (norm === "" || norm === ".") {
          cb(null, dirStat());
          return;
        }
        if (self.store.has(norm)) {
          const buf = self.store.get(norm)!;
          cb(null, fileStat(buf.length));
          return;
        }
        const search = `${norm}/`;
        for (const p of self.store.keys()) {
          if (p.startsWith(search)) {
            cb(null, dirStat());
            return;
          }
        }
        cb(enoent(path));
      },
      lstat(path: string, cb: NodeCallback<StatLike>): void {
        this.stat(path, cb);
      },
    };
  }

  // ── interna helpers ───────────────────────────────────────────

  private norm(path: string): string {
    return path.replace(/^\/+/, "").replace(/\/+$/, "");
  }
}

function enoent(path: string): NodeJS.ErrnoException {
  const err = new Error(`ENOENT: no such file or directory, '${path}'`) as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

function fileStat(size: number): StatLike {
  return {
    isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
    type: "file", mode: 0o100644, size,
    mtimeMs: 0, ctimeMs: 0, ino: 0, dev: 0, uid: 0, gid: 0,
  };
}

function dirStat(): StatLike {
  return {
    isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false,
    type: "dir", mode: 0o040755, size: 0,
    mtimeMs: 0, ctimeMs: 0, ino: 0, dev: 0, uid: 0, gid: 0,
  };
}
