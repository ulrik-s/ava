/**
 * `DrizzleSyncStore` (#sync-bridge, ADR 0017) — server-auktoritativ delta-sync
 * mot Postgres. Server-only (importerar db/change_log/Drizzle) → injiceras i
 * `createServerContext`, ALDRIG i den delade routern/klient-bundeln.
 *
 * pull: läs `change_log` (`seq > cursor`, per org), deduppa till senaste op per
 * rad, hämta kanonisk rad via repot (saknad/raderad → tombstone). Bara upp
 * till den säkra gränsen (#1381, `readSafeSeq`): rader under den committas
 * aldrig senare, så cursorn kan sättas till gränsen.
 * push: köformatet prövas (#1247), sedan avgörs posten i EN transaktion
 * (`RowPushDecider`, ADR 0017-konfliktklasserna). Utfallet sparas per byrå och
 * `mutationId` (#1414, `RowPushLedger`): en omsänd post — tappat svar, eller
 * samma kö från två flikar — får samma svar och tillämpas aldrig två gånger.
 */

import { and, asc, eq, gt, lte } from "drizzle-orm";
import { QUEUE_POLICY, type QueuePolicy } from "@/lib/shared/sync/queue-format";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PullResult, PulledChange, PushResult, RowRef } from "../data-store/in-memory/sync-transport";
import { changeLog } from "../db/schema";
import type { AppDb } from "../db/types";
import type { DrizzleRepositories } from "../repositories/drizzle-repositories";
import { readSafeSeq } from "./change-log-safe-seq";
import { canonicalRows, entityRepo, type EntityRepo } from "./entity-repo";
import { admitRow } from "./queue-admission";
import { RowPushDecider } from "./row-push-decider";
import { RowPushLedger } from "./row-push-ledger";
import type { RowPusher } from "./row-push-policy";
import type { SyncStore } from "./sync-store";

interface ChangeRow {
  seq: number;
  entity: string;
  rowId: string;
  op: string;
}

export class DrizzleSyncStore implements SyncStore {
  constructor(
    private readonly db: AppDb,
    private readonly repos: DrizzleRepositories,
    /** Köformatets gränser + migreringar (#1247); injicerbar i tester. */
    private readonly queuePolicy: QueuePolicy = QUEUE_POLICY,
  ) {}

  private repoFor(entity: string): EntityRepo | null {
    return entityRepo(this.repos, entity);
  }

  async pull(organizationId: string, sinceCursor: number): Promise<PullResult> {
    // Gränsen läses FÖRE raderna (egen sats → raderna läses i en senare
    // ögonblicksbild, där allt ≤ gränsen redan syns).
    const safe = await readSafeSeq(this.db);
    const rows: ChangeRow[] = await this.db
      .select({ seq: changeLog.seq, entity: changeLog.entity, rowId: changeLog.rowId, op: changeLog.op })
      .from(changeLog)
      .where(and(eq(changeLog.organizationId, organizationId), gt(changeLog.seq, sinceCursor), lte(changeLog.seq, safe)))
      .orderBy(asc(changeLog.seq));

    // Deduppa: senaste op per (entity,rowId) räcker (kanonisk rad hämtas ändå).
    const latest = new Map<string, ChangeRow>();
    for (const r of rows) latest.set(`${r.entity}:${r.rowId}`, r);
    // Cursorn går aldrig bakåt (en klient från en annan databas behåller sin).
    const cursor = Math.max(sinceCursor, safe);

    const changes: PulledChange[] = [];
    for (const r of latest.values()) {
      changes.push(await this.toChange(r));
    }
    return { changes, cursor };
  }

  private async toChange(r: ChangeRow): Promise<PulledChange> {
    const repo = this.repoFor(r.entity);
    const current = repo ? await repo.getById(r.rowId) : null;
    if (r.op === "delete" || !current) {
      return { entity: r.entity, row: { id: r.rowId }, deleted: true };
    }
    return { entity: r.entity, row: current };
  }

  rows(organizationId: string, refs: readonly RowRef[]): Promise<PulledChange[]> {
    return canonicalRows(this.repos, refs, organizationId);
  }

  async push(pusher: RowPusher, queued: QueuedMutation): Promise<PushResult> {
    // Köformatet (#1247): en för gammal post avvisas med ett besked; en äldre,
    // stödd migreras; en nyare än servern kastar (klienten försöker igen).
    const admission = admitRow(queued, this.queuePolicy);
    if (admission.kind === "reject") return { status: "conflict", reason: admission.reason };
    const m = admission.entry;
    return this.repos.transactionWithDb((tx, txDb, savepoint) =>
      pushOnce(new RowPushDecider(tx, savepoint), RowPushLedger.for(txDb, pusher, m), pusher, m));
  }
}

/**
 * Avgör posten en gång (#1414): har den redan avgjorts får den det sparade
 * utfallet med radens läge just nu; annars avgörs den och utfallet sparas i
 * samma transaktion som skrivningarna.
 */
async function pushOnce(decider: RowPushDecider, ledger: RowPushLedger | null, pusher: RowPusher, m: QueuedMutation): Promise<PushResult> {
  if (!ledger) return decider.decide(pusher, m);
  await ledger.lock();
  const stored = await ledger.stored();
  if (stored) return decider.replay(m, stored);
  const res = await decider.decide(pusher, m);
  await ledger.record(pusher, res);
  return res;
}
