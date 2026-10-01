/**
 * Backupläget (#1431) — rena regler, inget I/O.
 *
 * Servern vet bara två saker: när den senaste begäran gjordes (begärandefilen)
 * och när den nyaste exporten skrevs klart (filens mtime). Det räcker:
 *
 *   - ingen begäran, eller en export som är nyare än begäran → `idle`
 *   - begäran utan nyare export, yngre än tidsgränsen        → `running`
 *   - begäran utan nyare export, äldre än tidsgränsen        → `failed`
 *
 * En begäran tas bara emot när ingen pågår och när varken den senaste
 * begäran eller den senaste exporten är yngre än {@link BACKUP_MIN_INTERVAL_MS}
 * (en backup tar minuter och fyller disk — knappen ska inte gå att hamra på).
 */

import { TRPCError } from "@trpc/server";
import type { BackupExport, BackupState, BackupStatus } from "@/lib/shared/backup";
import type { BackupRequest } from "../ports";

/** Minsta tid mellan två backuper (begärda eller schemalagda). */
export const BACKUP_MIN_INTERVAL_MS = 10 * 60_000;

/** En begäran som inte gett en ny export inom en timme räknas som misslyckad. */
export const BACKUP_TIMEOUT_MS = 60 * 60_000;

function stateOf(latest: BackupExport | null, requestedAt: number | null, now: number): BackupState {
  if (requestedAt === null || (latest !== null && latest.createdAt >= requestedAt)) return "idle";
  return now - requestedAt < BACKUP_TIMEOUT_MS ? "running" : "failed";
}

function nextRequestAt(latest: BackupExport | null, requestedAt: number | null): number {
  const last = Math.max(requestedAt ?? 0, latest?.createdAt ?? 0);
  return last === 0 ? 0 : last + BACKUP_MIN_INTERVAL_MS;
}

/** Läget ur den nyaste exporten och den senaste begäran. */
export function backupStatus(latest: BackupExport | null, request: BackupRequest | null, now: number): BackupStatus {
  const requestedAt = request?.requestedAt ?? null;
  return { state: stateOf(latest, requestedAt, now), latest, requestedAt, nextRequestAt: nextRequestAt(latest, requestedAt) };
}

/** Kasta om en ny begäran inte tas emot nu: en pågår, eller den förra är för färsk. */
export function assertMayRequest(status: BackupStatus, now: number): void {
  if (status.state === "running") {
    throw new TRPCError({ code: "CONFLICT", message: "En backup pågår redan." });
  }
  if (now < status.nextRequestAt) {
    const minutes = Math.ceil((status.nextRequestAt - now) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `En backup togs eller begärdes nyss. Ladda ner den senaste, eller försök igen om ${minutes} min.`,
    });
  }
}
