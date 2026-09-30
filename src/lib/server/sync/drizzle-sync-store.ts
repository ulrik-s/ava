/**
 * `DrizzleSyncStore` (#sync-bridge, ADR 0017) — server-auktoritativ delta-sync
 * mot Postgres. Server-only (importerar db/change_log/Drizzle) → injiceras i
 * `createServerContext`, ALDRIG i den delade routern/klient-bundeln.
 *
 * pull: läs `change_log` (`seq > cursor`, per org), deduppa till senaste op per
 * rad, hämta kanonisk rad via repot (saknad/raderad → tombstone).
 * push: kontrollera byrån och avvisa procedurägda entiteter (#1242,
 * `push-guard` — tid, utlägg och fakturering skrivs bara av procedurkön), applicera sedan
 * en köad mutation per konfliktklass (ADR 0017):
 *   - create  → idempotent (finns id → accepted), annars create.
 *   - update  → surface: stale `baseVersion` ⇒ conflict; annars update
 *               (server-nyare ⇒ rebased). append/lww applicerar.
 *   - delete  → softDelete (redan borta ⇒ idempotent accepted).
 */

import { and, asc, eq, gt } from "drizzle-orm";
import { conflictClassOf } from "@/lib/shared/conflict-policy";
import { QUEUE_POLICY, type QueuePolicy } from "@/lib/shared/sync/queue-format";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PullResult, PulledChange, PushResult } from "../data-store/in-memory/sync-transport";
import { changeLog } from "../db/schema";
import type { AppDb } from "../db/types";
import type { Repositories } from "../repositories/repositories";
import { entityRepo, type EntityRepo, type Row } from "./entity-repo";
import { checkProcedureOwned, checkScope, type PushRejection } from "./push-guard";
import { admitRow } from "./queue-admission";
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
    const rows: ChangeRow[] = await this.db
      .select({ seq: changeLog.seq, entity: changeLog.entity, rowId: changeLog.rowId, op: changeLog.op })
      .from(changeLog)
      .where(and(eq(changeLog.organizationId, organizationId), gt(changeLog.seq, sinceCursor)))
      .orderBy(asc(changeLog.seq));

    // Deduppa: senaste op per (entity,rowId) räcker (kanonisk rad hämtas ändå).
    const latest = new Map<string, ChangeRow>();
    let cursor = sinceCursor;
    for (const r of rows) {
      latest.set(`${r.entity}:${r.rowId}`, r);
      if (r.seq > cursor) cursor = r.seq;
    }

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

  async push(organizationId: string, queued: QueuedMutation): Promise<PushResult> {
    // Köformatet (#1247): en för gammal post avvisas med ett besked; en äldre,
    // stödd migreras; en nyare än servern kastar (klienten försöker igen).
    const admission = admitRow(queued, this.queuePolicy);
    if (admission.kind === "reject") return { status: "conflict", reason: admission.reason };
    return this.pushAdmitted(organizationId, admission.entry);
  }

  private async pushAdmitted(organizationId: string, m: QueuedMutation): Promise<PushResult> {
    const repo = this.repoFor(m.entity);
    if (!repo) return { status: "conflict", reason: `okänd entitet: ${m.entity}` };
    // Ogiltigt (icke-uuid) rowId: kan aldrig lagras i de uuid-nycklade tabellerna.
    // Svara INTE "accepted" — då trodde klienten att raden sparats och den fanns
    // bara lokalt (dataförlust). "conflict" ackas också (inget 22P02-häng, #879)
    // men syns som konflikt. Klienten reparerar id:n före push (legacy-id-repair).
    if (!isUuidRowId(rowId(m))) return { status: "conflict", reason: `ogiltigt id (inte uuid): ${rowId(m)}` };
    const existing = await repo.getById(rowId(m));
    const rejected = await this.guard(organizationId, repo, m, existing);
    if (rejected) return { status: "conflict", ...rejected };
    if (m.kind === "delete") return this.applyDelete(repo, m, existing);
    if (m.kind === "create") return this.applyCreate(repo, m, existing);
    return this.applyUpdate(repo, m, existing);
  }

  /** Byrån och procedurägda entiteter (#1242): avvisas raden, skrivs ingenting. */
  private async guard(organizationId: string, repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushRejection | null> {
    const incoming = m.kind === "delete" ? null : m.row;
    const orgOf = (row: Row): Promise<string | undefined> => repo.organizationOf(row);
    return await checkScope(orgOf, organizationId, m.entity, existing, incoming)
      ?? checkProcedureOwned(m.entity, existing);
  }

  private async applyCreate(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (existing) return { status: "accepted", row: existing }; // idempotent replay
    return { status: "accepted", row: await repo.create(m.row) };
  }

  private async applyUpdate(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (!existing) return { status: "accepted", row: await repo.create(m.row) };
    const serverVersion = versionOf(existing);
    if (conflictClassOf(m.entity) === "surface" && m.baseVersion != null && serverVersion !== m.baseVersion) {
      return { status: "conflict", reason: "stale", current: existing };
    }
    // Server-ägda fält (dokumentets analys, #1280) skrivs aldrig av en radpush.
    const updated = await repo.update(rowId(m), withoutServerOwned(m.entity, existing, m.row));
    const rebased = m.baseVersion != null && serverVersion > m.baseVersion;
    return { status: rebased ? "rebased" : "accepted", row: updated };
  }

  private async applyDelete(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (!existing) return { status: "accepted", row: { id: rowId(m) } }; // redan borta
    return { status: "accepted", row: await repo.softDelete(rowId(m)) };
  }
}
