/**
 * Radpostens sparade utfall (#1414) — samma `mutationId` ger samma svar.
 *
 * En radpost kan nå servern flera gånger: svaret tappades efter att servern
 * tillämpat den, eller två flikar skickade samma kö. En ändring tillämpad två
 * gånger bumpade versionen igen, och en surface-ändring avvisades som
 * inaktuell mot sin egen första tillämpning. Utfallet sparas därför per byrå
 * och `mutationId` i `sync_replays`, samma tabell och form som procedurkönens
 * utfall (#1265): `accepted`, eller `rejected` med beskedet. Ett
 * transaktionslås per byrå och post gör att en samtidig omsändning väntar och
 * sedan får det sparade utfallet, i stället för att tillämpa posten igen.
 *
 * Poster med ett id som inte är ett uuid (äldre klienter) sparas inte — de
 * avgörs som förut.
 */

import { and, eq, sql } from "drizzle-orm";
import type { OrganizationId } from "@/lib/shared/schemas/ids";
import { isUuid } from "@/lib/shared/uuid";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PushResult } from "../data-store/in-memory/sync-transport";
import { syncReplays } from "../db/schema";
import type { AppDb } from "../db/types";
import type { RowPusher } from "./row-push-policy";

/** Ett sparat utfall: godtagen (eller ombaserad), eller avvisad med beskedet. */
export type StoredRowOutcome = { status: "accepted" } | { status: "rejected"; reason: string };

/** tRPC-koden en avvisad radpost sparas med (procedurernas utfall har sin regels kod). */
const ROW_REJECTED_CODE = "CONFLICT";

/** Radpostens "sökväg" i `sync_replays` — skiljer den från procedurernas. */
const pathOf = (m: QueuedMutation): string => `row:${m.entity}.${m.kind}`;

export class RowPushLedger {
  private constructor(private readonly db: AppDb, private readonly org: OrganizationId, private readonly m: QueuedMutation) {}

  /** Liggaren för posten, eller `null` när posten saknar ett uuid-id och inte kan sparas. */
  static for(db: AppDb, pusher: RowPusher, m: QueuedMutation): RowPushLedger | null {
    return isUuid(m.mutationId) ? new RowPushLedger(db, pusher.organizationId, m) : null;
  }

  /** Vänta ut en samtidig push av samma post (transaktionslås, släpps vid commit). */
  async lock(): Promise<void> {
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`row-push:${this.org}:${this.m.mutationId}`}))`);
  }

  /** Utfallet en tidigare push av posten fick, om någon. */
  async stored(): Promise<StoredRowOutcome | null> {
    const [row] = await this.db.select({ status: syncReplays.status, reason: syncReplays.reason }).from(syncReplays)
      .where(and(eq(syncReplays.organizationId, this.org), eq(syncReplays.mutationId, this.m.mutationId))).limit(1);
    if (!row) return null;
    return row.status === "accepted" ? { status: "accepted" } : { status: "rejected", reason: row.reason ?? "" };
  }

  /** Spara utfallet (i samma transaktion som postens skrivningar). */
  async record(pusher: RowPusher, res: PushResult): Promise<void> {
    const rejected = res.status === "conflict";
    await this.db.insert(syncReplays).values({
      mutationId: this.m.mutationId,
      organizationId: this.org,
      userId: pusher.userId,
      path: pathOf(this.m),
      codeVersion: `queue-format:${this.m.format ?? 1}`,
      status: rejected ? "rejected" : "accepted",
      code: rejected ? ROW_REJECTED_CODE : null,
      reason: rejected ? res.reason : null,
    }).onConflictDoNothing({ target: [syncReplays.organizationId, syncReplays.mutationId] });
  }
}
