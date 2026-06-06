/**
 * `FilesystemClaimStore` — `IClaimStore`-implementation som använder
 * git-push-CAS som distribuerad mutex.
 *
 * Algoritm (per spike-resultat i `spikes/claim-race/`):
 *   1. Fetch + reset till remote head
 *   2. Kontrollera om claimId redan ligger i dagens claims-JSONL
 *      → om ja, jämför claimedBy. Vi vinner om vi var den första.
 *   3. Annars: append vår claim-rad, commit, push
 *      → om push lyckas: vi vann
 *      → om NonFastForward: reset, fetch igen, gå tillbaka till steg 2.
 *      Max N retries (default 50).
 *
 * Design (SOLID):
 *   - Beror på `IFileSystem` och `IGitOps` (DI). Tester använder
 *     `InMemory*` för deterministiska assertions.
 *   - Single responsibility: bara claim-mekanismen. Inga side-effects
 *     utanför claims-mappen.
 */

import type { IClaimStore, ClaimOpts } from "../data-store/IDataStore";
import type { IFileSystem } from "./file-system";
import type { IGitOps } from "./git-ops";
import { ClaimsProjection, type ClaimRow } from "./projections/claims";

const DEFAULT_TTL_SEC = 300; // 5 min
const DEFAULT_MAX_RETRIES = 50;

export class FilesystemClaimStore implements IClaimStore {
  private projection = new ClaimsProjection();

  constructor(
    private fs: IFileSystem,
    private git: IGitOps,
    private me: string,
    private maxRetries: number = DEFAULT_MAX_RETRIES,
  ) {}

  // eslint-disable-next-line complexity -- TODO: refactor (currently fails complexity@8: Async method 'tryClaim' has a complexity of 9. Maximum allowed is 8.)
  async tryClaim(claimId: string, opts: ClaimOpts): Promise<boolean> {
    const ttlSec = opts.ttlSec ?? DEFAULT_TTL_SEC;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      await this.git.fetch();
      await this.git.resetHardToRemote();

      const existing = await this.findClaim(claimId);
      if (existing && existing.claimedBy !== this.me && !this.isExpired(existing)) {
        return false; // någon annan har en levande claim
      }
      if (existing && existing.claimedBy === this.me) {
        return true; // re-entrant
      }

      const row: ClaimRow = {
        claimId,
        claimedBy: this.me,
        at: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttlSec * 1000).toISOString(),
      };
      const path = this.projection.pathFor(row);
      await this.fs.appendFile(path, this.projection.serializeLine(row) + "\n");
      await this.git.commit(`claim: ${claimId} by ${this.me}`);
      const push = await this.git.push();
      if (push.ok) return true;
      // NonFastForward: någon hann före, börja om
    }
    return false;
  }

  async isStale(claimId: string): Promise<boolean> {
    const existing = await this.findClaim(claimId);
    if (!existing) return false;
    return this.isExpired(existing);
  }

  // ── interna ──────────────────────────────────────────────────

  private isExpired(row: ClaimRow): boolean {
    return new Date(row.expiresAt).getTime() < Date.now();
  }

  /**
   * Sök igenom dagens + gårdagens claim-JSONL efter en match på claimId.
   * Om vi är nära midnatt kan vinnaren och förloraren landa i olika filer
   * — därför kollar vi båda dagarna.
   */
  private async findClaim(claimId: string): Promise<ClaimRow | null> {
    const today = new Date();
    const candidates = [
      this.projection.pathFor({
        claimId, claimedBy: "", at: today.toISOString(), expiresAt: today.toISOString(),
      }),
      this.projection.pathFor({
        claimId, claimedBy: "", at: new Date(today.getTime() - 86400_000).toISOString(),
        expiresAt: today.toISOString(),
      }),
    ];
    for (const path of new Set(candidates)) {
      if (!(await this.fs.exists(path))) continue;
      const content = await this.fs.readFile(path);
      const lines = content.split("\n").filter(Boolean);
      // Iterera baklänges — vi vill ha senaste matchande raden
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const row = this.projection.deserializeLine(lines[i]!);
          if (row.claimId === claimId) return row;
        } catch {
          // Trasig rad — hoppa över, robust mot partial writes
        }
      }
    }
    return null;
  }
}
