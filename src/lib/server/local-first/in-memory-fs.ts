/**
 * `InMemoryFileSystem` — test-fixture som implementerar `IFileSystem` mot
 * ett Map<path, content>.
 *
 * Begränsningar (medvetna):
 *   - Ingen permissions, ingen `stat`, inga symlinks
 *   - `listDir` är en linjär scan — duger för testbaser <1000 filer
 *
 * Real fil-system-backend (Tauri / Node fs/promises) bor i `node-fs.ts`
 * när vi når runtime-integration.
 */

import type { IFileSystem } from "./file-system";

export class InMemoryFileSystem implements IFileSystem {
  private files: Map<string, string> = new Map();

  async readFile(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) {
      const err = new Error(`ENOENT: file not found: ${path}`);
      (err as NodeJS.ErrnoException).code = "ENOENT";
      throw err;
    }
    return v;
  }

  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async appendFile(path: string, content: string): Promise<void> {
    const cur = this.files.get(path) ?? "";
    this.files.set(path, cur + content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async listDir(prefix: string): Promise<string[]> {
    const norm = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const direct: Set<string> = new Set();
    for (const p of this.files.keys()) {
      if (!p.startsWith(norm)) continue;
      const rest = p.slice(norm.length);
      const firstSlash = rest.indexOf("/");
      direct.add(firstSlash === -1 ? rest : rest.slice(0, firstSlash));
    }
    return Array.from(direct);
  }

  /** Test-only: ta en plain-object-kopia. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
