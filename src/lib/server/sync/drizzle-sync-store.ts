/**
 * `DrizzleSyncStore` (#sync-bridge, ADR 0017) — server-auktoritativ delta-sync
 * mot Postgres. Server-only (importerar db/change_log/Drizzle) → injiceras i
 * `createServerContext`, ALDRIG i den delade routern/klient-bundeln.
 *
 * pull: läs `change_log` (`seq > cursor`, per org), deduppa till senaste op per
 * rad, hämta kanonisk rad via repot (saknad/raderad → tombstone). Bara upp
 * till den säkra gränsen (#1381, `readSafeSeq`): rader under den committas
 * aldrig senare, så cursorn kan sättas till gränsen.
 * push: kontrollera byrån, avvisa procedurägda entiteter (#1242,
 * `push-guard` — tid, utlägg, fakturering, användare och byråinställningar
 * skrivs bara av procedurkön) och pröva radvägens policy (#1344,
 * `row-push-policy`: neka som standard, referenser inom byrån, vem som skapade
 * raden), applicera sedan en köad mutation per konfliktklass (ADR 0017):
 *   - create  → idempotent (finns id → accepted), annars create.
 *   - update  → surface: saknad eller stale `baseVersion` ⇒ conflict; annars
 *               update (server-nyare ⇒ rebased). append/lww applicerar.
 *               När raden skapades och vem som skapade den ändras aldrig.
 *   - delete  → softDelete (redan borta ⇒ idempotent accepted).
 */

import { and, asc, eq, gt, lte } from "drizzle-orm";
import { conflictClassOf } from "@/lib/shared/conflict-policy";
import { QUEUE_POLICY, type QueuePolicy } from "@/lib/shared/sync/queue-format";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PullResult, PulledChange, PushResult, RowRef } from "../data-store/in-memory/sync-transport";
import { changeLog } from "../db/schema";
import type { AppDb } from "../db/types";
import type { Repositories } from "../repositories/repositories";
import { readSafeSeq } from "./change-log-safe-seq";
import { canonicalRows, entityRepo, type EntityRepo, type Row } from "./entity-repo";
import { checkProcedureOwned, checkScope, type PushRejection } from "./push-guard";
import { admitRow } from "./queue-admission";
import { checkRowPolicy, immutableOnUpdate, type RowPolicyRejection, type RowPusher } from "./row-push-policy";
import { withoutServerOwned } from "./server-owned-fields";
import type { SyncStore } from "./sync-store";

interface ChangeRow {
  seq: number;
  entity: string;
  rowId: string;
  op: string;
}

function rowId(m: QueuedMutation): string {
  return typeof m.row.id === "string" ? m.row.id : "";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Alla server-tabeller är uuid-nycklade (#879). Ett icke-uuid rowId (t.ex. ett
 *  lokalt genererat nanoid) kan aldrig lagras → `getById` skulle kasta 22P02 och
 *  abortera hela reconcile-batchen. */
function isUuidRowId(id: string): boolean { return UUID_RE.test(id); }

function versionOf(row: Row | null): number {
  return row && typeof row.version === "number" ? row.version : 1;
}

/** Beskedet när en ändring av en surface-entitet saknar versionen den byggde på (#1344). */
export const MISSING_BASE_VERSION_REASON = "saknar basversion";

export class DrizzleSyncStore implements SyncStore {
  constructor(
    private readonly db: AppDb,
    private readonly repos: Repositories,
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
    return this.pushAdmitted(pusher, admission.entry);
  }

  private async pushAdmitted(pusher: RowPusher, m: QueuedMutation): Promise<PushResult> {
    const repo = this.repoFor(m.entity);
    if (!repo) return { status: "conflict", reason: `okänd entitet: ${m.entity}` };
    // Ogiltigt (icke-uuid) rowId: kan aldrig lagras i de uuid-nycklade tabellerna.
    // Svara INTE "accepted" — då trodde klienten att raden sparats och den fanns
    // bara lokalt (dataförlust). "conflict" ackas också (inget 22P02-häng, #879)
    // men syns som konflikt. Klienten reparerar id:n före push (legacy-id-repair).
    if (!isUuidRowId(rowId(m))) return { status: "conflict", reason: `ogiltigt id (inte uuid): ${rowId(m)}` };
    const existing = await repo.getById(rowId(m));
    const rejected = await this.guard(pusher, repo, m, existing);
    if (rejected) return { status: "conflict", ...rejected };
    if (m.kind === "delete") return this.applyDelete(repo, m, existing);
    if (m.kind === "create") return this.applyCreate(repo, m, existing);
    return this.applyUpdate(repo, m, existing);
  }

  /**
   * Byrån, procedurägda entiteter (#1242) och radvägens policy (#1344):
   * avvisas raden, skrivs ingenting.
   */
  private async guard(pusher: RowPusher, repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushRejection | RowPolicyRejection | null> {
    const incoming = m.kind === "delete" ? null : m.row;
    const orgOf = (row: Row): Promise<string | undefined> => repo.organizationOf(row);
    return await checkScope(orgOf, pusher.organizationId, existing, incoming)
      ?? checkProcedureOwned(m.entity, existing)
      ?? await checkRowPolicy({ entity: m.entity, kind: m.kind, incoming, existing, pusher, refOrg: (e, id) => this.refOrg(e, id) });
  }

  /** Byrån en refererad rad hör till; `null` om den inte finns. */
  private async refOrg(entity: string, id: string): Promise<string | null | undefined> {
    const repo = this.repoFor(entity);
    const row = repo ? await repo.getById(id) : null;
    return repo && row ? repo.organizationOf(row) : null;
  }

  private async applyCreate(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (existing) return { status: "accepted", row: existing }; // idempotent replay
    return { status: "accepted", row: await repo.create(m.row) };
  }

  private async applyUpdate(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (!existing) return { status: "accepted", row: await repo.create(m.row) };
    const serverVersion = versionOf(existing);
    const surfaceConflict = this.surfaceConflict(m, serverVersion);
    if (surfaceConflict) return { status: "conflict", reason: surfaceConflict, current: existing };
    // Server-ägda fält (dokumentets analys, #1280) och radens ursprung (när och
    // av vem, #1344) skrivs aldrig av en radpush.
    const patch = immutableOnUpdate(m.entity, withoutServerOwned(m.entity, existing, m.row));
    const updated = await repo.update(rowId(m), patch);
    const rebased = m.baseVersion != null && serverVersion > m.baseVersion;
    return { status: rebased ? "rebased" : "accepted", row: updated };
  }

  /**
   * En surface-entitet ändras bara mot den version klienten byggde på: saknas
   * den (#1344) kan servern inte se om ändringen är inaktuell — avvisas, i
   * stället för att tyst skriva över.
   */
  private surfaceConflict(m: QueuedMutation, serverVersion: number): string | null {
    if (conflictClassOf(m.entity) !== "surface") return null;
    if (m.baseVersion == null) return MISSING_BASE_VERSION_REASON;
    return serverVersion === m.baseVersion ? null : "stale";
  }

  private async applyDelete(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (!existing) return { status: "accepted", row: { id: rowId(m) } }; // redan borta
    return { status: "accepted", row: await repo.softDelete(rowId(m)) };
  }
}
