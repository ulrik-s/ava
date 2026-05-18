/**
 * `IFileSystem` — abstraktionen som låter `LocalGitStore` jobba mot
 * antingen Tauri's filsystem-API, Node's `fs/promises`, eller en
 * in-memory-implementation för tester.
 *
 * Designval (Dependency inversion + Liskov):
 *   - Små metoder med entydig semantik. Inga directory-handles.
 *   - All path-handling i POSIX-stil (forward slash). Backend översätter
 *     vid behov.
 *   - `appendFile` är en explicit metod (inte read+concat+write) så att
 *     en framtida Tauri-backend kan använda `O_APPEND` för atomicitet.
 */

export interface IFileSystem {
  /** Läs hela filen som UTF-8-text. Kastar om filen inte finns. */
  readFile(path: string): Promise<string>;

  /** Skriv (eller ersätt) en fil. Mappar skapas implicit. */
  writeFile(path: string, content: string): Promise<void>;

  /** Append-write. Skapar filen om den inte fanns. */
  appendFile(path: string, content: string): Promise<void>;

  /** Existerar denna path som en fil? */
  exists(path: string): Promise<boolean>;

  /** Radera en fil. No-op om den inte fanns. */
  deleteFile(path: string): Promise<void>;

  /**
   * Lista filer + sub-mappar **direkt** under prefixet (inte rekursivt).
   * Returnerar bara namnen (utan prefixet).
   */
  listDir(prefix: string): Promise<string[]>;
}
