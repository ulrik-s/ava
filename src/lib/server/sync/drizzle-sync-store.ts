/**
 * `DrizzleSyncStore` (#sync-bridge, ADR 0017) — server-auktoritativ delta-sync
 * mot Postgres. Server-only (importerar db/change_log/Drizzle) → injiceras i
 * `createServerContext`, ALDRIG i den delade routern/klient-bundeln.
 *
 * pull: läs `change_log` (`seq > cursor`, per org), deduppa till senaste op per
 * rad, hämta kanoniska rader via repot (saknad/raderad → tombstone). Bara upp
 * till den säkra gränsen (#1381, `readSafeSeq`): rader under den committas
 * aldrig senare, så cursorn kan sättas till gränsen. Sidindelad (#1388): högst
 * `pageLimit` loggrader per anrop, och raderna hämtas med EN fråga per entitet.
 * Finns fler sätts `hasMore` och cursorn till sidans sista seq (aldrig förbi
 * gränsen) — klienten pullar igen från den.
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
import { canonicalRows, entityRepo, type EntityRepo, type Row } from "./entity-repo";
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

/**
 * Högst så många change_log-rader per pull (#1388). En klient som legat offline
 * länge, eller pullar efter en storm, hämtar i bitar i stället för tusentals
 * rader i ett svar.
 */
export const PULL_PAGE_LIMIT = 500;

/** En sida ur change_log: raderna, cursorn efter dem, och om fler finns. */
interface ChangePage {
  rows: ChangeRow[];
  cursor: number;
  hasMore: boolean;
}

export class DrizzleSyncStore implements SyncStore {
  constructor(
    private readonly db: AppDb,
    private readonly repos: DrizzleRepositories,
    /** Köformatets gränser + migreringar (#1247); injicerbar i tester. */
    private readonly queuePolicy: QueuePolicy = QUEUE_POLICY,
    /** Loggrader per pull (#1388); injicerbar i tester. */
    private readonly pageLimit: number = PULL_PAGE_LIMIT,
  ) {}

  private repoFor(entity: string): EntityRepo | null {
    return entityRepo(this.repos, entity);
  }

  async pull(organizationId: string, sinceCursor: number): Promise<PullResult> {
    // Gränsen läses FÖRE raderna (egen sats → raderna läses i en senare
    // ögonblicksbild, där allt ≤ gränsen redan syns).
    const safe = await readSafeSeq(this.db);
    // En rad extra avslöjar om det finns fler än en sida.
    const rows: ChangeRow[] = await this.db
      .select({ seq: changeLog.seq, entity: changeLog.entity, rowId: changeLog.rowId, op: changeLog.op })
      .from(changeLog)
      .where(and(eq(changeLog.organizationId, organizationId), gt(changeLog.seq, sinceCursor), lte(changeLog.seq, safe)))
      .orderBy(asc(changeLog.seq))
      .limit(this.pageLimit + 1);
    const page = pageOf(rows, this.pageLimit, sinceCursor, safe);
    const changes = await this.toChanges(latestPerRow(page.rows));
    return { changes, cursor: page.cursor, hasMore: page.hasMore };
  }

  /** Kanoniskt läge för sidans rader: en fråga per entitet, i följd (#1388). */
  private async toChanges(rows: readonly ChangeRow[]): Promise<PulledChange[]> {
    const current = new Map<string, Row>();
    for (const [entity, ids] of idsPerEntity(rows)) {
      for (const row of await this.currentRows(entity, ids)) current.set(`${entity}:${String(row.id)}`, row);
    }
    return rows.map((r) => toChange(r, current.get(`${r.entity}:${r.rowId}`)));
  }

  /** Radernas nuvarande läge; en entitet som inte synkas ger inga rader → tombstone. */
  private currentRows(entity: string, ids: readonly string[]): Promise<Row[]> {
    const repo = this.repoFor(entity);
    return repo ? repo.getByIds(ids) : Promise.resolve([]);
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
 * Sidan ur de lästa raderna (högst `limit + 1`). Ryms allt sätts cursorn till
 * den säkra gränsen — den går aldrig bakåt (en klient från en annan databas
 * behåller sin). Annars sätts den till sidans sista seq, som ligger under
 * gränsen, och resten hämtas i nästa pull.
 */
function pageOf(rows: ChangeRow[], limit: number, sinceCursor: number, safe: number): ChangePage {
  if (rows.length <= limit) return { rows, cursor: Math.max(sinceCursor, safe), hasMore: false };
  const page = rows.slice(0, limit);
  return { rows: page, cursor: page.at(-1)?.seq ?? sinceCursor, hasMore: true };
}

/** Senaste op per (entity,rowId) räcker — det kanoniska läget hämtas ändå. */
function latestPerRow(rows: readonly ChangeRow[]): ChangeRow[] {
  const latest = new Map<string, ChangeRow>();
  for (const r of rows) latest.set(`${r.entity}:${r.rowId}`, r);
  return [...latest.values()];
}

/** Rad-id:n att läsa, per entitet — en raderad rad blir tombstone utan läsning. */
function idsPerEntity(rows: readonly ChangeRow[]): Map<string, string[]> {
  const ids = new Map<string, string[]>();
  for (const r of rows.filter((row) => row.op !== "delete")) {
    const list = ids.get(r.entity);
    if (list) list.push(r.rowId);
    else ids.set(r.entity, [r.rowId]);
  }
  return ids;
}

/** En raderad eller saknad rad blir en tombstone. */
function toChange(r: ChangeRow, current: Row | undefined): PulledChange {
  if (r.op === "delete" || !current) return { entity: r.entity, row: { id: r.rowId }, deleted: true };
  return { entity: r.entity, row: current };
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
