/**
 * Scenario 5 — samma mutation från flera flikar/enheter samtidigt (#1366,
 * #1332, #1346). Kölagringen per flik är klientens sak (#1346); här prövas
 * SERVERNS idempotens: samma `mutationId` skickas samtidigt från `LOAD_TABS`
 * flikar, och ska tillämpas exakt en gång.
 *
 * Köposterna är äkta: en användare gör ändringarna offline (procedurkön för
 * tidsposter, radkön för kontakter), och samma poster skickas sedan från
 * alla flikar på en gång — för varje post samtidigt.
 */

import { TRPCClientError } from "@trpc/client";
import { z } from "zod";
import { TrpcSyncTransport } from "@/lib/client/sync/trpc-sync-transport";
import { isProcedureCall, type QueueEntry } from "@/lib/server/data-store/in-memory/mutation-queue";
import { addContact, logTime } from "../actions";
import { ActionTally, dbFor, type LoadContext, type ScenarioResult } from "../context";
import { timedFetch } from "../http-metrics";
import { idempotencyViolations, type IdempotencyObservation } from "../invariants";
import { rng } from "../rng";
import type { ServerDb } from "../server-db";
import { serverClient, type VirtualUser } from "../virtual-user";

/** Radens id för en köpost: anropets `input.id` (create) eller radens `id`. */
export function rowIdOf(entry: QueueEntry): string {
  const id = isProcedureCall(entry) ? entry.input.id : entry.row.id;
  return typeof id === "string" ? id : "";
}

const trpcErrorData = z.object({ httpStatus: z.number(), code: z.string() });

/** Ett fel från en flik som en kort kod: `fel 500:INTERNAL_SERVER_ERROR`. */
export function failureCode(err: unknown): string {
  if (!(err instanceof TRPCClientError)) return err instanceof Error ? `fel: ${err.message.slice(0, 80)}` : "fel";
  const data: unknown = err.data;
  const parsed = trpcErrorData.safeParse(data);
  return parsed.success ? `fel ${parsed.data.httpStatus}:${parsed.data.code}` : `fel: ${err.message.slice(0, 80)}`;
}

/** Status eller felkod för ett svar från en flik. */
async function send(tab: TrpcSyncTransport, entry: QueueEntry): Promise<string> {
  try {
    return (isProcedureCall(entry) ? await tab.pushProcedure(entry) : await tab.push(entry)).status;
  } catch (err) {
    return failureCode(err);
  }
}

async function observe(db: ServerDb, entry: QueueEntry, statuses: string[]): Promise<IdempotencyObservation> {
  const table = isProcedureCall(entry) ? "time_entries" : "contacts";
  return {
    mutationId: entry.mutationId,
    statuses,
    rowCount: (await db.existing(table, [rowIdOf(entry)])).length,
    storedOutcomes: isProcedureCall(entry) ? await db.storedOutcomes(entry.mutationId) : null,
  };
}

/** Köa ändringarna offline och returnera köposterna. */
async function queuedEntries(vu: VirtualUser, matterId: string, calls: number, tally: ActionTally): Promise<QueueEntry[]> {
  const r = rng(vu.index * 101);
  vu.online = false;
  const before = new Set(vu.store.pendingEntries().map((e) => e.mutationId));
  for (let i = 0; i < calls; i++) {
    await tally.run("tid (flikar)", () => logTime(vu, matterId, r, `flik u${vu.index}.${i}`));
    if (i % 2 === 0) await tally.run("kontakt (flikar)", () => addContact(vu, `flik u${vu.index}.${i}`));
  }
  return vu.store.pendingEntries().filter((e) => !before.has(e.mutationId));
}

async function runForUser(ctx: LoadContext, vu: VirtualUser, tally: ActionTally): Promise<IdempotencyObservation[]> {
  const entries = await queuedEntries(vu, ctx.matters.get(vu.index) ?? "", ctx.config.idempotentCalls, tally);
  const tabs = Array.from({ length: ctx.config.tabs }, () =>
    new TrpcSyncTransport(serverClient(vu.user.org, timedFetch({ recorder: ctx.recorder, email: vu.user.email, isOnline: () => true }))));
  // Varje flik spelar upp kön i ordning, en post i taget (som appen), och alla
  // flikar samtidigt — samma post når servern från alla flikar på en gång.
  const statuses: string[][] = entries.map(() => []);
  await Promise.all(tabs.map(async (t) => {
    for (const [i, e] of entries.entries()) statuses[i]?.push(await send(t, e));
  }));
  const db = dbFor(ctx, vu.user.org.index);
  const observations = await Promise.all(entries.map((e, i) => observe(db, e, statuses[i] ?? [])));
  // Användarens egen flik skickar sedan samma poster en gång till — servern ska ge det sparade utfallet.
  vu.online = true;
  await vu.drain(60_000).catch((e: unknown) => tally.fail("tömning", e));
  return observations;
}

export async function runIdempotency(ctx: LoadContext): Promise<ScenarioResult> {
  const start = Date.now();
  const tally = new ActionTally();
  // En användare per byrå, alla byråer samtidigt.
  const chosen = ctx.config.orgs.flatMap((org) => ctx.users.find((u) => u.user.org.index === org.index) ?? []);
  const observations = (await Promise.all(chosen.map((vu) => runForUser(ctx, vu, tally)))).flat();
  const violations = idempotencyViolations(observations).map((v) => `idempotens: ${v}`);
  if (tally.failures > 0) violations.push(`idempotens: ${tally.failures} handlingar misslyckades (se exempel)`);
  const statusCounts: Record<string, number> = {};
  for (const s of observations.flatMap((o) => o.statuses)) statusCounts[s] = (statusCounts[s] ?? 0) + 1;
  return {
    scenario: "idempotency",
    durationMs: Date.now() - start,
    details: { tabs: ctx.config.tabs, mutations: observations.length, statusCounts, actions: tally.toJSON() },
    violations,
  };
}
