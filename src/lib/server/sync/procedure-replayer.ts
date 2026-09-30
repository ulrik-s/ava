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
 * Samma anrop körs högst en gång, också när två omkörningar kommer samtidigt
 * (två flikar, två enheter, ett omförsök medan det första pågår; #1332): ett
 * transaktionslås per `mutationId`, och kontrollen av `sync_replays` görs
 * efter låset i samma transaktion.
 *
 * Svaret bär de berörda radernas kanoniska läge, lästa org-scopat: en rad i
 * en annan byrå blir en tombstone, aldrig data.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import type { OrganizationId } from "@/lib/shared/schemas/ids";
import { QUEUE_POLICY, type QueuePolicy } from "@/lib/shared/sync/queue-format";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import type { ProcedureTouch, QueuedProcedureCall } from "../data-store/in-memory/mutation-queue";
import type { ProcedureReplayResult, PulledChange } from "../data-store/in-memory/sync-transport";
import { syncReplays } from "../db/schema";
import type { AppDb } from "../db/types";
import type { DrizzleRepositories } from "../repositories/drizzle-repositories";
import { appRouter } from "../routers/_app";
import type { Context } from "../trpc-core";
import { entityRepo, getInOrg } from "./entity-repo";
import { admitProcedure } from "./queue-admission";

/** tRPC-koder som betyder "anropet bryter mot en regel" — permanenta, inte tekniska. */
const RULE_CODES: ReadonlySet<string> = new Set(["BAD_REQUEST", "NOT_FOUND", "PRECONDITION_FAILED", "FORBIDDEN", "CONFLICT"]);

type Outcome =
  | { status: "accepted" }
  | { status: "rejected"; code: string; reason: string };

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
    /** Köformatets gränser + migreringar (#1247); injicerbar i tester. */
    private readonly queuePolicy: QueuePolicy = QUEUE_POLICY,
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
    const stored = await this.storedOutcome(this.db, call.mutationId, orgId);
    if (stored) return stored;
    // Köformatet (#1247): för gammal → avvisad (sparas som utfall); nyare än
    // servern → kastar före allt annat (inget utfall, klienten försöker igen).
    const admission = admitProcedure(call, this.queuePolicy);
    if (admission.kind === "reject") return this.rejectOutright(call, ctx, orgId, admission.reason);
    return this.run(admission.entry, ctx, orgId);
  }

  private rejectOutright(call: QueuedProcedureCall, ctx: Context, orgId: OrganizationId, reason: string): Promise<Outcome> {
    return this.recordOnce(call, ctx, orgId, { status: "rejected", code: "PRECONDITION_FAILED", reason });
  }

  private async run(call: QueuedProcedureCall, ctx: Context, orgId: OrganizationId): Promise<Outcome> {
    try {
      return await this.repos.transactionWithDb(async (tx, txDb): Promise<Outcome> => {
        // En omkörning i taget per anrop (#1332); den som kommer sist får
        // utfallet den första sparade — proceduren körs inte igen.
        await txDb.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`replay:${call.mutationId}`}))`);
        const stored = await this.storedOutcome(txDb, call.mutationId, orgId);
        if (stored) return stored;
        // Samma identitet som klientens körning (#1276): skapade rader får
        // samma id, affärsdatum är när anropet gjordes — inte nu.
        const queued = { mutationId: call.mutationId, at: call.enqueuedAt };
        await resolveProcedure(appRouter.createCaller({ ...ctx, repos: tx, queued }), call.path)(call.input);
        await this.record(txDb, call, ctx, orgId, { status: "accepted" });
        return { status: "accepted" };
      });
    } catch (err) {
      const rejected = ruleViolation(err);
      if (!rejected) throw err;
      return this.recordOnce(call, ctx, orgId, rejected);
    }
  }

  /**
   * Spara en avvisning. Har en samtidig omkörning hunnit spara ett utfall
   * gäller det (#1332) — samma mutationId ger alltid samma svar.
   */
  private async recordOnce(call: QueuedProcedureCall, ctx: Context, orgId: OrganizationId, outcome: Outcome): Promise<Outcome> {
    await this.record(this.db, call, ctx, orgId, outcome);
    return (await this.storedOutcome(this.db, call.mutationId, orgId)) ?? outcome;
  }

  private async storedOutcome(db: AppDb, mutationId: string, orgId: OrganizationId): Promise<Outcome | null> {
    const [row] = await db.select().from(syncReplays)
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

  /**
   * De berörda radernas kanoniska läge, bara inom byrån. Alla berörda entiteter
   * — en procedur kan skriva flera (faktureringen, #1276). En rad som inte finns
   * (eller tillhör en annan byrå) blir en tombstone: klientens optimistiska rad
   * tas bort, och serverns rad (om någon) kommer med pull.
   */
  private async currentRows(call: QueuedProcedureCall, orgId: OrganizationId): Promise<PulledChange[]> {
    const readable = call.touches.filter((t: ProcedureTouch) => entityRepo(this.repos, t.entity) !== null);
    return Promise.all(readable.map(async (t): Promise<PulledChange> => {
      const row = await getInOrg(this.repos, t.entity, t.id, orgId);
      return row ? { entity: t.entity, row } : { entity: t.entity, row: { id: t.id }, deleted: true };
    }));
  }
}
