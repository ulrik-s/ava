/**
 * "Markera som rådgivning" i procedur-kön (#1349, ADR 0037).
 *
 * Tidsposter är procedurägda (#1242): servern tar inte emot dem som färdiga
 * rader. `timeEntry.markAsRadgivning` köades inte — i self-hosted avvisades
 * radpushen och markeringen gick förlorad. Nu köas anropet och servern kör om
 * det. Det som skyddas:
 *   - låstidpunkten är när anropet GJORDES, inte när servern kör om det,
 *   - restposten (minuter över timmen) får ett id härlett ur anropet — samma
 *     id som i klientens körning,
 *   - samma anrop en gång till ger samma utfall och ingen andra restpost,
 *   - reglerna gäller på servern: ett ärende som redan har en låst post
 *     avvisar en andra markering.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { RADGIVNING_INVOICE_NOTES } from "@/lib/shared/radgivning-entry";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const USER = uuidv7();
/** Anropet gjordes i går (hela sekunder, som tidsstämplarna lagras) — servern kör om det nu. */
const MADE_AT = Math.floor((Date.now() - 86_400_000) / 1000) * 1000;

describe("Markera som rådgivning i procedur-kön (#1349)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as never);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(input: Record<string, unknown>, touches: Array<{ entity: string; id: string }> = []): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(MADE_AT), path: "timeEntry.markAsRadgivning", input, codeVersion: "test", enqueuedAt: MADE_AT, touches };
  }

  /** Rättshjälpsärende med rådgivningsfaktura från före #1205 (ingen låst post) och ett möte på `minutes`. */
  async function legacyMatter(minutes: number): Promise<{ matterId: string; invoiceId: string; entryId: string }> {
    const matterId = uuidv7(), invoiceId = uuidv7(), entryId = uuidv7();
    await repos.matters.create({
      id: matterId, organizationId: ORG, title: "Vårdnad", status: "ACTIVE", matterNumber: `2026-${matterId.slice(-4)}`,
      paymentMethod: "RATTSHJALP", radgivningBetaldAt: new Date("2026-03-01"),
    } as never);
    await repos.invoices.create({
      id: invoiceId, matterId, amount: 203_250, invoiceType: "STANDARD", status: "SENT", invoiceDate: new Date("2026-03-01"), notes: RADGIVNING_INVOICE_NOTES,
    } as never);
    await repos.timeEntries.create({
      id: entryId, matterId, userId: USER, date: new Date("2026-03-02"), minutes, description: "Första möte", hourlyRate: 250_000, billable: true, kind: "ARBETE",
    } as never);
    return { matterId, invoiceId, entryId };
  }

  /** Ärendets poster: de låsta mot rådgivningsfakturan + de olåsta, i minuter. */
  async function minutesIn(m: { matterId: string; invoiceId: string }): Promise<number[]> {
    const locked = await repos.timeEntries.listByInvoice(asId<"InvoiceId">(m.invoiceId));
    const open = await repos.timeEntries.listUnfrozenForMatter(asId<"MatterId">(m.matterId));
    return [...locked, ...open].map((e) => e.minutes).sort((a, b) => a - b);
  }

  it("köas som anrop", () => {
    expect(isQueuedProcedure("timeEntry.markAsRadgivning")).toBe(true);
  });

  it("90 min: posten låses (60 min, anropets tid) och resten får id härlett ur anropet", async () => {
    const { invoiceId, entryId } = await legacyMatter(90);
    const c = call({ id: entryId });
    const remainderId = derivedId(c.mutationId, "radgivningRemainder");
    const res = await replayer.replay({ ...c, touches: [{ entity: "timeEntry", id: entryId }, { entity: "timeEntry", id: remainderId }] }, ctx);
    expect(res.status).toBe("accepted");
    const locked = await repos.timeEntries.getById(asId<"TimeEntryId">(entryId));
    expect(locked).toMatchObject({ minutes: 60, invoiceId });
    expect(new Date(String(locked?.frozenAt)).getTime()).toBe(MADE_AT);
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(remainderId))).toMatchObject({ minutes: 30, invoiceId: null, frozenAt: null, description: "Första möte" });
    expect(res.rows.map((r) => r.row.id)).toEqual([entryId, remainderId]);
  });

  it("samma anrop en gång till: samma utfall, ingen andra restpost", async () => {
    const m = await legacyMatter(75);
    const c = call({ id: m.entryId });
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    expect(await minutesIn(m)).toEqual([15, 60]);
  });

  it("≤ 60 min: ingen restpost", async () => {
    const m = await legacyMatter(45);
    expect((await replayer.replay(call({ id: m.entryId }), ctx)).status).toBe("accepted");
    expect(await minutesIn(m)).toEqual([45]);
  });

  it("reglerna gäller på servern: en andra markering i samma ärende avvisas", async () => {
    const { matterId, entryId } = await legacyMatter(60);
    expect((await replayer.replay(call({ id: entryId }), ctx)).status).toBe("accepted");
    const other = uuidv7();
    await repos.timeEntries.create({ id: other, matterId, userId: USER, date: new Date("2026-03-03"), minutes: 30, description: "Samtal", hourlyRate: 250_000, billable: true, kind: "ARBETE" } as never);
    expect(await replayer.replay(call({ id: other }), ctx)).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
  });
});
