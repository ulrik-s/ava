/**
 * `DrizzleProcedureReplayer` (#1265, ADR 0037) — servern kör om ett köat
 * procedur-anrop AUKTORITATIVT: samma `appRouter` som klienten, i en
 * transaktion, som den användare som skickade anropet. Affärsreglerna (låsta
 * poster, belopp, statusflöden) gäller därmed här — klientens lokala körning
 * var bara optimistisk.
 *
 * Server-only (importerar appRouter + db) → injiceras via `createServerContext`
 * som `ctx.replayProcedure`; sync-routern känner bara till porten.
 *
 * Utfall:
 *   - accepted — anropet kördes; utfallet sparas i `sync_replays` i SAMMA
 *     transaktion, så ett avbrott mellan commit och svar ger inte en andra körning.
 *   - rejected — en affärsregel (tRPC-klientfel: BAD_REQUEST, NOT_FOUND,
 *     PRECONDITION_FAILED, FORBIDDEN, CONFLICT) avvisade anropet; ingenting
 *     skrevs, utfallet sparas så att samma mutationId ger samma svar.
 *   - tekniska fel (databasen, en bugg) är INGET utfall: de kastas, och
 *     klienten försöker igen — användarens arbete kastas aldrig för ett
 *     serverfel.
 *
 * Svaret bär de berörda radernas kanoniska läge, lästa org-scopat: en rad i
 * en annan byrå blir en tombstone, aldrig data.
 */

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { asId, type OrganizationId } from "@/lib/shared/schemas/ids";
import { isQueuedProcedure, queuedProcedureEntity } from "@/lib/shared/sync/queued-procedures";
import type { ProcedureTouch, QueuedProcedureCall } from "../data-store/in-memory/mutation-queue";
import type { ProcedureReplayResult, PulledChange } from "../data-store/in-memory/sync-transport";
import { syncReplays } from "../db/schema";
import type { AppDb } from "../db/types";
import type { DrizzleRepositories } from "../repositories/drizzle-repositories";
import type { Repositories } from "../repositories/repositories";
import { appRouter } from "../routers/_app";
import type { Context } from "../trpc-core";

/** tRPC-koder som betyder "anropet bryter mot en regel" — permanenta, inte tekniska. */
const RULE_CODES: ReadonlySet<string> = new Set(["BAD_REQUEST", "NOT_FOUND", "PRECONDITION_FAILED", "FORBIDDEN", "CONFLICT"]);

type Outcome =
  | { status: "accepted" }
  | { status: "rejected"; code: string; reason: string };

/** Läs en berörd rad inom byrån (null = finns inte, eller tillhör en annan byrå). */
type OrgScopedGetter = (repos: Repositories, id: string, orgId: OrganizationId) => Promise<Record<string, unknown> | null>;

/** Hur varje köbar entitet läses tillbaka org-scopat. Utökas när fler entiteter flyttas. */
const ORG_SCOPED_GETTERS: Readonly<Record<string, OrgScopedGetter>> = {
  timeEntry: (repos, id, orgId) => repos.timeEntries.getByIdInOrg(asId<"TimeEntryId">(id), orgId),
};

/** Porten sync-routern anropar (via `ctx.replayProcedure`). */
export interface ProcedureReplayer {
  replay(call: QueuedProcedureCall, ctx: Context): Promise<ProcedureReplayResult>;
}

/** Walka `a.b.c` på caller-proxyn till procedurfunktionen. */
function resolveProcedure(caller: unknown, path: string): (input: unknown) => Promise<unknown> {
  let cur: unknown = caller;
  for (const seg of path.split(".")) cur = (cur as Record<string, unknown>)[seg];
  return cur as (input: unknown) => Promise<unknown>;
}

/** Ett regelbrott → avvisning; allt annat → kasta vidare (tekniskt fel, försök igen). */
function ruleViolation(err: unknown): Outcome | null {
  if (err instanceof TRPCError && RULE_CODES.has(err.code)) {
    return { status: "rejected", code: err.code, reason: err.message };
  }
  return null;
}

export class DrizzleProcedureReplayer implements ProcedureReplayer {
  constructor(
    private readonly db: AppDb,
    private readonly repos: DrizzleRepositories,
  ) {}

  async replay(call: QueuedProcedureCall, ctx: Context): Promise<ProcedureReplayResult> {
    const orgId = ctx.user?.organizationId;
    if (!orgId) throw new TRPCError({ code: "UNAUTHORIZED" });
    const outcome = await this.outcomeFor(call, ctx, orgId);
    return { ...outcome, rows: await this.currentRows(call, orgId) };
  }

  private async outcomeFor(call: QueuedProcedureCall, ctx: Context, orgId: OrganizationId): Promise<Outcome> {
    if (!isQueuedProcedure(call.path)) {
      return { status: "rejected", code: "BAD_REQUEST", reason: `Proceduren ${call.path} kan inte köas.` };
    }
    const stored = await this.storedOutcome(call.mutationId, orgId);
    if (stored) return stored;
    try {
      await this.repos.transactionWithDb(async (tx, txDb) => {
        await resolveProcedure(appRouter.createCaller({ ...ctx, repos: tx }), call.path)(call.input);
        await this.record(txDb, call, ctx, orgId, { status: "accepted" });
      });
      return { status: "accepted" };
    } catch (err) {
      const rejected = ruleViolation(err);
      if (!rejected) throw err;
      await this.record(this.db, call, ctx, orgId, rejected);
      return rejected;
    }
  }

  private async storedOutcome(mutationId: string, orgId: OrganizationId): Promise<Outcome | null> {
    const [row] = await this.db.select().from(syncReplays)
      .where(and(eq(syncReplays.mutationId, mutationId), eq(syncReplays.organizationId, orgId))).limit(1);
    if (!row) return null;
    return row.status === "accepted"
      ? { status: "accepted" }
      : { status: "rejected", code: row.code ?? "BAD_REQUEST", reason: row.reason ?? "" };
  }

  private async record(db: AppDb, call: QueuedProcedureCall, ctx: Context, orgId: OrganizationId, outcome: Outcome): Promise<void> {
    await db.insert(syncReplays).values({
      mutationId: call.mutationId,
      organizationId: orgId,
      userId: ctx.user?.id ?? null,
      path: call.path,
      codeVersion: call.codeVersion,
      status: outcome.status,
      code: outcome.status === "rejected" ? outcome.code : null,
      reason: outcome.status === "rejected" ? outcome.reason : null,
    }).onConflictDoNothing();
  }

  /** De berörda radernas kanoniska läge — bara procedurens entitet, bara inom byrån. */
  private async currentRows(call: QueuedProcedureCall, orgId: OrganizationId): Promise<PulledChange[]> {
    const entity = queuedProcedureEntity(call.path);
    const getter = entity ? ORG_SCOPED_GETTERS[entity] : undefined;
    if (!entity || !getter) return [];
    const touches = call.touches.filter((t: ProcedureTouch) => t.entity === entity);
    return Promise.all(touches.map(async (t): Promise<PulledChange> => {
      const row = await getter(this.repos, t.id, orgId);
      return row ? { entity, row } : { entity, row: { id: t.id }, deleted: true };
    }));
  }
}
