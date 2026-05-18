/**
 * `NodeFileSystem` — `IFileSystem`-implementation mot `node:fs/promises`.
 *
 * Använder en `root`-katalog som sandbox. Alla path-argument är relativa
 * till root och får INTE escape:a den (path-traversal-skydd).
 *
 * Designval (Single responsibility):
 *   - Den här klassen vet bara hur man läser/skriver filer på disk.
 *     Den känner ingenting till git, projektioner eller events.
 *
 * Designval (Liskov):
 *   - Samma kontrakt som `InMemoryFileSystem`. Tester av högre lager
 *     kan kör mot bägge två utan ändringar.
 */

import {
  readFile, writeFile, appendFile, unlink, mkdir, readdir, stat,
} from "node:fs/promises";
import { join, relative, resolve, dirname } from "node:path";
import type { IFileSystem } from "./file-system";

export class NodeFileSystem implements IFileSystem {
  private readonly absRoot: string;

  constructor(root: string) {
    this.absRoot = resolve(root);
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.resolveSafe(path), "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const abs = this.resolveSafe(path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }

  async appendFile(path: string, content: string): Promise<void> {
    const abs = this.resolveSafe(path);
    await mkdir(dirname(abs), { recursive: true });
    await appendFile(abs, content, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolveSafe(path));
      return true;
    } catch {
      return false;
    }
  }

  async deleteFile(path: string): Promise<void> {
    try {
      await unlink(this.resolveSafe(path));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async listDir(prefix: string): Promise<string[]> {
    try {
      return await readdir(this.resolveSafe(prefix));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  // ── private ───────────────────────────────────────────────────

  /**
   * Resolva relativ path mot root och säkerställ att resultatet INTE
   * ligger utanför root (path traversal-skydd).
   *
   * `..` i input som inte tar oss utanför är OK (t.ex. `a/../b.txt`).
   */
  private resolveSafe(path: string): string {
    const abs = resolve(this.absRoot, path);
    const rel = relative(this.absRoot, abs);
    if (rel.startsWith("..") || rel === "..") {
      throw new Error(`Refusing to access path outside root: ${path}`);
    }
    return abs;
  }
}
