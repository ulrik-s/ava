/**
 * `DrizzleSyncStore` (#sync-bridge, ADR 0017) — server-auktoritativ delta-sync
 * mot Postgres. Server-only (importerar db/change_log/Drizzle) → injiceras i
 * `createServerContext`, ALDRIG i den delade routern/klient-bundeln.
 *
 * pull: läs `change_log` (`seq > cursor`, per org), deduppa till senaste op per
 * rad, hämta kanonisk rad via repot (saknad/raderad → tombstone).
 * push: applicera en köad mutation per konfliktklass (ADR 0017):
 *   - create  → idempotent (finns id → accepted), annars create.
 *   - update  → surface: stale `baseVersion` ⇒ conflict; annars update
 *               (server-nyare ⇒ rebased). append/lww applicerar.
 *   - delete  → softDelete (redan borta ⇒ idempotent accepted).
 */

import { and, asc, eq, gt } from "drizzle-orm";
import { conflictClassOf } from "@/lib/shared/conflict-policy";
import { SOURCE_KEY_BY_ENTITY } from "../data-store/in-memory/entity-source-keys";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PullResult, PulledChange, PushResult } from "../data-store/in-memory/sync-transport";
import { changeLog } from "../db/schema";
import type { AppDb } from "../db/types";
import type { Repositories } from "../repositories/repositories";
import type { SyncStore } from "./sync-store";

type Row = Record<string, unknown>;

/**
 * Den heterogena delmängd av en entitets-repo som sync-bryggan kallar, typad mot
 * den strukturella rad-formen (`Record<string, unknown>`) i st.f. en specifik
 * entitet. Domän-rad-typerna (zod `.passthrough()`) bär en index-signatur och är
 * därför tilldelningsbara hit — så varje `Repository<Domän>` uppfyller `BaseRepo`
 * (metod-bivarians på param + kovariant retur via index-signaturen). Det låter
 * `repoFor` returnera en TYPAD repo utan rad-castar nedströms.
 */
interface BaseRepo {
  getById(id: string): Promise<Row | null>;
  create(data: Row): Promise<Row>;
  update(id: string, patch: Row): Promise<Row>;
  softDelete(id: string): Promise<Row>;
}

/** Repo-nycklarna i registret (alla fält utom `transaction`). */
type RepoKey = keyof Omit<Repositories, "transaction">;

interface ChangeRow {
  seq: number;
  entity: string;
  rowId: string;
  op: string;
}

function rowId(m: QueuedMutation): string {
  return typeof m.row.id === "string" ? m.row.id : "";
}

function versionOf(row: Row | null): number {
  return row && typeof row.version === "number" ? row.version : 1;
}

export class DrizzleSyncStore implements SyncStore {
  constructor(
    private readonly db: AppDb,
    private readonly repos: Repositories,
  ) {}

  private repoFor(entity: string): BaseRepo | null {
    const key = SOURCE_KEY_BY_ENTITY[entity];
    if (!key) return null;
    // `key` är en source-key (= repo-fältnamn); den dynamiska dispatchen kräver
    // en keyof-assertion (sträng→nyckel), men VÄRDET förblir typat (BaseRepo).
    return this.repos[key as RepoKey] ?? null;
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

  async push(_organizationId: string, m: QueuedMutation): Promise<PushResult> {
    const repo = this.repoFor(m.entity);
    if (!repo) return { status: "conflict", reason: `okänd entitet: ${m.entity}` };
    if (m.kind === "delete") return this.applyDelete(repo, m);
    if (m.kind === "create") return this.applyCreate(repo, m);
    return this.applyUpdate(repo, m);
  }

  private async applyCreate(repo: BaseRepo, m: QueuedMutation): Promise<PushResult> {
    const existing = await repo.getById(rowId(m));
    if (existing) return { status: "accepted", row: existing }; // idempotent replay
    const created = await repo.create(m.row);
    return { status: "accepted", row: created };
  }

  private async applyUpdate(repo: BaseRepo, m: QueuedMutation): Promise<PushResult> {
    const existing = await repo.getById(rowId(m));
    if (!existing) return { status: "accepted", row: await repo.create(m.row) };
    const serverVersion = versionOf(existing);
    if (conflictClassOf(m.entity) === "surface" && m.baseVersion != null && serverVersion !== m.baseVersion) {
      return { status: "conflict", reason: "stale", current: existing };
    }
    const updated = await repo.update(rowId(m), m.row);
    const rebased = m.baseVersion != null && serverVersion > m.baseVersion;
    return { status: rebased ? "rebased" : "accepted", row: updated };
  }

  private async applyDelete(repo: BaseRepo, m: QueuedMutation): Promise<PushResult> {
    const existing = await repo.getById(rowId(m));
    if (!existing) return { status: "accepted", row: { id: rowId(m) } }; // redan borta
    return { status: "accepted", row: await repo.softDelete(rowId(m)) };
  }
}
