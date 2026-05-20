/**
 * `FsaIsoGitAdapter` — wrappar `FileSystemDirectoryHandle` som ett
 * `fs`-objekt isomorphic-git kan använda.
 *
 * Implementerar bara de API:er isomorphic-git faktiskt kallar:
 *   - readFile, writeFile, unlink
 *   - readdir, mkdir, rmdir
 *   - stat, lstat
 *   - readlink, symlink (no-op — git tracking av symlinks utelämnas)
 *
 * isomorphic-git förväntar sig Node-style `fs.promises`-API. Alla
 * paths är absoluta relativa repo-roten ("/contacts/x.json").
 *
 * Designval (Single responsibility):
 *   - Bara fs-mappning. Inga git-konventioner här.
 *
 * Designval (Defensiv):
 *   - Saknad fil → ENOENT-error, samma som node-fs.
 *   - Recursive mkdir hanteras manuellt eftersom FSA inte har det.
 */

interface IsoFsStat {
  type: "file" | "dir";
  mode: number;
  size: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
  uid: number;
  gid: number;
  dev: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}

function enoent(path: string): Error {
  const err = new Error(`ENOENT: no such file or directory, '${path}'`) as Error & {
    code: string; errno: number; syscall: string; path: string;
  };
  err.code = "ENOENT";
  err.errno = -2;
  err.syscall = "open";
  err.path = path;
  return err;
}

function splitPath(p: string): string[] {
  // Normalisera: '.' och '/.' tolkas som rooten (samma semantik som POSIX).
  // isomorphic-git anropar `lstat('.')` i statusMatrix → måste returnera dir.
  const normalized = p
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (normalized === "" || normalized === ".") return [];
  // Filtrera bort tomma + isolerade '.'-segment ('./foo' → ['foo'])
  return normalized.split("/").filter((s) => s !== "" && s !== ".");
}

async function resolveDir(
  root: FileSystemDirectoryHandle,
  parts: string[],
  create = false,
): Promise<FileSystemDirectoryHandle> {
  let cur = root;
  for (const part of parts) {
    cur = await cur.getDirectoryHandle(part, { create });
  }
  return cur;
}

export class FsaIsoGitAdapter {
  constructor(private root: FileSystemDirectoryHandle) {}

  /** Node fs.promises-kompatibelt API. */
  get promises() {
    return this;
  }

  async readFile(
    path: string,
    opts?: { encoding?: string } | string,
  ): Promise<Uint8Array | string> {
    const parts = splitPath(path);
    const filename = parts.pop();
    if (!filename) throw enoent(path);
    let dir: FileSystemDirectoryHandle;
    try { dir = await resolveDir(this.root, parts); } catch { throw enoent(path); }
    let fh: FileSystemFileHandle;
    try { fh = await dir.getFileHandle(filename); } catch { throw enoent(path); }
    const file = await fh.getFile();
    const buf = new Uint8Array(await file.arrayBuffer());
    const encoding = typeof opts === "string" ? opts : opts?.encoding;
    if (encoding === "utf8" || encoding === "utf-8") {
      return new TextDecoder().decode(buf);
    }
    return buf;
  }

  async writeFile(
    path: string,
    data: Uint8Array | string,
    _opts?: { encoding?: string } | string,
  ): Promise<void> {
    const parts = splitPath(path);
    const filename = parts.pop();
    if (!filename) throw new Error(`Invalid path: ${path}`);
    const dir = await resolveDir(this.root, parts, true);
    const fh = await dir.getFileHandle(filename, { create: true });
    const writable = await fh.createWritable();
    try {
      const body = typeof data === "string"
        ? new TextEncoder().encode(data)
        : new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await writable.write(body as any);
    } finally {
      await writable.close();
    }
  }

  async unlink(path: string): Promise<void> {
    const parts = splitPath(path);
    const filename = parts.pop();
    if (!filename) throw enoent(path);
    const dir = await resolveDir(this.root, parts);
    await dir.removeEntry(filename);
  }

  async readdir(path: string): Promise<string[]> {
    const parts = splitPath(path);
    let dir: FileSystemDirectoryHandle;
    try { dir = await resolveDir(this.root, parts); } catch { throw enoent(path); }
    const names: string[] = [];
    // `entries()` finns på FileSystemDirectoryHandle men saknas i vissa
    // TS-libs. Casta för iteration.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const [name] of (dir as any).entries()) names.push(name as string);
    return names;
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const parts = splitPath(path);
    if (opts?.recursive) {
      await resolveDir(this.root, parts, true);
      return;
    }
    const last = parts.pop();
    if (!last) return;
    const parent = await resolveDir(this.root, parts);
    await parent.getDirectoryHandle(last, { create: true });
  }

  async rmdir(path: string): Promise<void> {
    const parts = splitPath(path);
    const last = parts.pop();
    if (!last) return;
    const parent = await resolveDir(this.root, parts);
    await parent.removeEntry(last, { recursive: true });
  }

  async stat(path: string): Promise<IsoFsStat> {
    const parts = splitPath(path);
    if (parts.length === 0) return makeStat("dir", 0, 0);
    const last = parts.pop()!;
    const parent = await resolveDir(this.root, parts).catch(() => null);
    if (!parent) throw enoent(path);
    // Probe file first, then directory
    try {
      const fh = await parent.getFileHandle(last);
      const f = await fh.getFile();
      return makeStat("file", f.size, f.lastModified);
    } catch { /* not a file */ }
    try {
      await parent.getDirectoryHandle(last);
      return makeStat("dir", 0, 0);
    } catch { /* not a dir either */ }
    throw enoent(path);
  }

  async lstat(path: string): Promise<IsoFsStat> {
    return this.stat(path);
  }

  // FSA kan inte representera symlinks — git-arkiv med symlinks
  // hanteras som vanliga filer.
  async readlink(_path: string): Promise<string> {
    throw new Error("symlinks ej stödda i FSA-adapter");
  }

  async symlink(_target: string, _path: string): Promise<void> {
    throw new Error("symlinks ej stödda i FSA-adapter");
  }
}

function makeStat(type: "file" | "dir", size: number, mtimeMs: number): IsoFsStat {
  return {
    type,
    mode: type === "dir" ? 0o040755 : 0o100644,
    size,
    ino: 0,
    mtimeMs,
    ctimeMs: mtimeMs,
    uid: 0,
    gid: 0,
    dev: 0,
    isDirectory: () => type === "dir",
    isFile: () => type === "file",
    isSymbolicLink: () => false,
  };
}
