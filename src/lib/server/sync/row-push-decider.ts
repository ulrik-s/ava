/**
 * Hur servern avgör en köad radpost (#sync-bridge, ADR 0017) — inom EN
 * transaktion (`repos`/`db` är bundna till den, #1414):
 *
 * kontrollera byrån, avvisa procedurägda entiteter (#1242, `push-guard` —
 * tid, utlägg, fakturering, användare och byråinställningar skrivs bara av
 * procedurkön) och pröva radvägens policy (#1344, `row-push-policy`: neka som
 * standard, referenser inom byrån, vem som skapade raden), applicera sedan
 * posten per konfliktklass:
 *   - create  → idempotent (finns id och samma skapande → accepted; en annan
 *               rad med samma id → conflict), annars create. Hinner en samtidig
 *               push av samma rad före (unikhetsfel, #1380) avgörs posten igen
 *               mot den raden — aldrig ett 500.
 *   - update  → finns inte raden (borttagen, #1399) ⇒ conflict utan `current`
 *               (klienten hämtar tombstonen), aldrig en ny rad med samma id.
 *               surface: saknad eller stale `baseVersion` ⇒ conflict; annars
 *               update (server-nyare ⇒ rebased). append/lww applicerar.
 *               När raden skapades och vem som skapade den ändras aldrig.
 *   - delete  → softDelete (redan borta ⇒ idempotent accepted). Svaret är
 *               en tombstone (`deleted`, #1397), aldrig en levande rad.
 * Ett data- eller integritetsfel från databasen (SQLSTATE 22/23) blir en
 * konflikt (#1399): samma post ger samma fel igen, och ett 500 skulle hålla
 * klientens kö i omförsök. Varje försök körs i en savepoint, så att ett fel
 * inte avbryter transaktionen (utfallet sparas i den efteråt, #1414).
 */

import { conflictClassOf } from "@/lib/shared/conflict-policy";
import { syncErrorMessage } from "@/lib/shared/sync/sync-error";
import { isUuid } from "@/lib/shared/uuid";
import type { QueuedMutation } from "../data-store/in-memory/mutation-queue";
import type { PushResult } from "../data-store/in-memory/sync-transport";
import { deterministicPgCause, isUniqueViolation } from "../db/pg-error";
import type { Savepoint } from "../repositories/drizzle-repositories";
import type { Repositories } from "../repositories/repositories";
import { entityRepo, type EntityRepo, type Row } from "./entity-repo";
import { checkProcedureOwned, checkScope, type PushRejection } from "./push-guard";
import type { StoredRowOutcome } from "./row-push-ledger";
import { checkRowPolicy, immutableOnUpdate, isSameCreation, type RowPolicyRejection, type RowPusher } from "./row-push-policy";
import { withoutServerOwned } from "./server-owned-fields";

/** Radens id ur posten ("" om det saknas). */
export function rowIdOf(m: QueuedMutation): string {
  return typeof m.row.id === "string" ? m.row.id : "";
}

function versionOf(row: Row | null): number {
  return row && typeof row.version === "number" ? row.version : 1;
}

/** Beskedet när en ändring av en surface-entitet saknar versionen den byggde på (#1344). */
export const MISSING_BASE_VERSION_REASON = "saknar basversion";

/** En create vars id redan bär en annan rad (annat skapande) (#1380). */
export const ID_TAKEN_REASON = "id:t används redan av en annan rad";

/** En skrivning som krockar med en befintlig rad även efter ett nytt försök (#1380). */
export const DUPLICATE_ROW_REASON = "raden krockar med en befintlig rad (samma id eller unikt värde)";

/** En ändring av en rad som inte finns på servern — borttagen, eller aldrig skapad (#1399). */
export const ROW_GONE_REASON = "raden finns inte längre på servern (borttagen)";

/**
 * Ett fel som samma post ger igen (SQLSTATE 22/23) → konflikt; allt annat
 * (nätet, databasen nere) kastas vidare så att klienten försöker igen.
 */
function deterministicConflict(err: unknown): PushResult {
  const cause = deterministicPgCause(err);
  if (cause === undefined) throw err;
  const reason = isUniqueViolation(cause) ? DUPLICATE_ROW_REASON : `Ändringen gick inte att spara: ${syncErrorMessage(cause)}`;
  return { status: "conflict", reason };
}

/** En entitet som inte synkas. */
function unknownEntity(m: QueuedMutation): PushResult {
  return { status: "conflict", reason: `okänd entitet: ${m.entity}` };
}

export class RowPushDecider {
  constructor(private readonly repos: Repositories, private readonly savepoint: Savepoint) {}

  /** Avgör och applicera posten. */
  async decide(pusher: RowPusher, m: QueuedMutation): Promise<PushResult> {
    if (!entityRepo(this.repos, m.entity)) return unknownEntity(m);
    // Ogiltigt (icke-uuid) rowId: kan aldrig lagras i de uuid-nycklade tabellerna.
    // Svara INTE "accepted" — då trodde klienten att raden sparats och den fanns
    // bara lokalt (dataförlust). "conflict" ackas också (inget 22P02-häng, #879)
    // men syns som konflikt. Klienten reparerar id:n före push (legacy-id-repair).
    if (!isUuid(rowIdOf(m).toLowerCase())) return { status: "conflict", reason: `ogiltigt id (inte uuid): ${rowIdOf(m)}` };
    try {
      return await this.attempt(pusher, m);
    } catch (err) {
      if (!isUniqueViolation(err)) return deterministicConflict(err);
      return this.decideAfterRace(pusher, m);
    }
  }

  /**
   * Svaret på en post som redan avgjorts (#1414): det sparade utfallet, med
   * radens läge just nu (tombstone om den inte finns) — posten tillämpas inte igen.
   */
  async replay(m: QueuedMutation, stored: StoredRowOutcome): Promise<PushResult> {
    if (stored.status === "rejected") return { status: "conflict", reason: stored.reason };
    const row = await entityRepo(this.repos, m.entity)?.getById(rowIdOf(m));
    return row ? { status: "accepted", row } : { status: "accepted", row: { id: rowIdOf(m) }, deleted: true };
  }

  /** Ett försök i en savepoint: ett databasfel rullar bara tillbaka försöket. */
  private attempt(pusher: RowPusher, m: QueuedMutation): Promise<PushResult> {
    return this.savepoint((repos) => new RowApplication(repos).apply(pusher, m));
  }

  /**
   * En samtidig push av samma rad hann före (#1380): avgör en gång till mot
   * raden som nu finns — byrå, policy och "samma skapande" prövas igen, så
   * svaret blir detsamma som för en omsändning i följd. Krockar det ändå
   * (raden är borttagen men id:t finns kvar, eller ett annat unikt värde är
   * taget) blir det en konflikt, aldrig ett 500.
   */
  private async decideAfterRace(pusher: RowPusher, m: QueuedMutation): Promise<PushResult> {
    try {
      return await this.attempt(pusher, m);
    } catch (err) {
      return deterministicConflict(err);
    }
  }
}

/** Ett försök att applicera posten, med repon bundna till försökets savepoint. */
class RowApplication {
  constructor(private readonly repos: Repositories) {}

  apply(pusher: RowPusher, m: QueuedMutation): Promise<PushResult> {
    const repo = entityRepo(this.repos, m.entity);
    return repo ? this.applyTo(repo, pusher, m) : Promise.resolve(unknownEntity(m));
  }

  private async applyTo(repo: EntityRepo, pusher: RowPusher, m: QueuedMutation): Promise<PushResult> {
    const existing = await repo.getById(rowIdOf(m));
    // Raden är borttagen (eller fanns aldrig): en ändring skapar den inte igen
    // (#1399). Ingen `current` — klienten hämtar tombstonen med `sync.rows`.
    if (!existing && m.kind === "update") return { status: "conflict", reason: ROW_GONE_REASON };
    const rejected = await this.guard(pusher, repo, m, existing);
    if (rejected) return { status: "conflict", ...rejected };
    if (m.kind === "delete") return this.applyDelete(repo, m, existing);
    if (m.kind === "create" || !existing) return this.applyCreate(repo, m, existing);
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
    const repo = entityRepo(this.repos, entity);
    const row = repo ? await repo.getById(id) : null;
    return repo && row ? repo.organizationOf(row) : null;
  }

  private async applyCreate(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (!existing) return { status: "accepted", row: await repo.create(m.row) };
    // Omsändning av samma skapande → idempotent; en annan rad med samma id → konflikt (#1380).
    if (isSameCreation(m.entity, existing, m.row)) return { status: "accepted", row: existing };
    return { status: "conflict", reason: ID_TAKEN_REASON, current: existing };
  }

  private async applyUpdate(repo: EntityRepo, m: QueuedMutation, existing: Row): Promise<PushResult> {
    const serverVersion = versionOf(existing);
    const surfaceConflict = this.surfaceConflict(m, serverVersion);
    if (surfaceConflict) return { status: "conflict", reason: surfaceConflict, current: existing };
    // Server-ägda fält (dokumentets analys, #1280) och radens ursprung (när och
    // av vem, #1344) skrivs aldrig av en radpush.
    const patch = immutableOnUpdate(m.entity, withoutServerOwned(m.entity, existing, m.row));
    const updated = await repo.update(rowIdOf(m), patch);
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

  /** Radera (redan borta ⇒ idempotent). Svaret är en tombstone (#1397). */
  private async applyDelete(repo: EntityRepo, m: QueuedMutation, existing: Row | null): Promise<PushResult> {
    if (existing) await repo.softDelete(rowIdOf(m));
    return { status: "accepted", row: { id: rowIdOf(m) }, deleted: true };
  }
}
