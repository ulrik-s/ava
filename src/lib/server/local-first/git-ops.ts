/**
 * `IGitOps` — kontraktet för git-operationer som `LocalGitStore` behöver.
 *
 * Designval (Dependency inversion):
 *   - Inga referenser till `isomorphic-git` här. Realimplementationen
 *     ligger i `isomorphic-git-ops.ts` (när vi når Tauri-runtime).
 *   - Tester använder `in-memory-git-ops.ts` som simulerar push-CAS
 *     mellan konkurrerande klienter.
 *
 * Minimerar yta: vi tar bara ut de operationer regelmotorn + claim-store
 * + sync-loopen faktiskt behöver. Andra git-features (rebase, tag,
 * branch) bryts upp i separata interfaces när vi kommer dit.
 */

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  ts: string;
}

export interface PushResult {
  ok: boolean;
  /**
   * Anledning vid misslyckad push. `"NonFastForward"` när remote ändrats
   * sedan vår senaste fetch — klienten ska reset:a och försöka igen.
   */
  reason?: "NonFastForward" | "NetworkError" | "Unknown";
}

export interface IGitOps {
  /** Hämta från remote (uppdaterar `remoteHead`). */
  fetch(): Promise<void>;

  /** Hash + meta för senaste commit på remote main. */
  remoteHead(): Promise<GitCommit>;

  /** Hash + meta för senaste local commit. */
  localHead(): Promise<GitCommit>;

  /** Vilka commits ligger lokalt utöver remote? */
  pendingCommitsAhead(): Promise<GitCommit[]>;

  /** Stage + commit allt som ändrats i working tree. */
  commit(message: string): Promise<GitCommit>;

  /** Försök pusha. CAS — misslyckas om remote drivit fram. */
  push(): Promise<PushResult>;

  /**
   * Hård reset till remote main. Slänger lokala commits + working tree
   * changes. Används efter `NonFastForward` för att kunna börja om.
   */
  resetHardToRemote(): Promise<void>;

  /**
   * Lista filer som ändrats mellan två commits (added/modified/deleted).
   *
   * Används av sync-loopen för att avgöra vilka projektioner som behöver
   * re-hydratiseras efter en fetch. Path-formatet är relativt repo-roten.
   *
   * Om `fromHash` är tom sträng tolkas det som "first commit" — då
   * returneras alla filer i `toHash`.
   */
  changedFiles(fromHash: string, toHash: string): Promise<string[]>;
}
