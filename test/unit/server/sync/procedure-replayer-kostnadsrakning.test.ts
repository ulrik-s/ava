/**
 * Kostnadsräkningsflödet och slutregleringen i procedur-kön, steg 2d (#1276).
 *
 * Servern kör om inskick, beslut, överklagande, faktura efter dom,
 * slutreglering och försäkringens prutning. Det som skyddas:
 *   - rader proceduren skapar (körningen, prutningsutlägget, fakturorna,
 *     klient-/betalarkörningen) får SAMMA id som i klientens körning,
 *   - värderingsdag, fakturadatum, frysdatum och KR-referensens år är när
 *     anropet GJORDES — inte när servern kör om det,
 *   - flödets regler gäller på servern (faktura först efter beslut).
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
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { QUEUE_POLICY } from "@/lib/shared/sync/queue-format";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const USER = uuidv7();
/** Anropet gjordes på nyårsafton 2025 — servern kör om det i januari 2026. */
const MADE_AT = Date.UTC(2025, 11, 31, 10, 0);
/** Servern kör om anropet tre dagar senare — inom gränsen för anropstiden (#1350). */
const REPLAYED_AT = MADE_AT + 3 * 86_400_000;

describe("kostnadsräkning och slutreglering i procedur-kön (#1276, steg 2d)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos, QUEUE_POLICY, () => REPLAYED_AT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(MADE_AT), path, input, codeVersion: "test", enqueuedAt: MADE_AT, touches: [] };
  }
  async function matterWithWork(paymentMethod: string, extra: Record<string, unknown> = {}): Promise<{ matterId: string; entryId: string }> {
    const matterId = uuidv7();
    await repos.matters.create({
      id: matterId, organizationId: ORG, title: "Kostnadsräkning", status: "ACTIVE",
      matterNumber: `2025-${matterId.slice(-4)}`, paymentMethod, responsibleLawyerId: USER, ...extra,
    } as never);
    const entryId = uuidv7();
    await repos.timeEntries.create({ id: entryId, matterId, userId: USER, date: new Date("2025-12-01"), minutes: 120, description: "Förhandling", hourlyRate: 150_000, billable: true } as never);
    return { matterId, entryId };
  }
  async function accepted(c: QueuedProcedureCall): Promise<void> {
    const res = await replayer.replay(c, ctx);
    expect(res).toMatchObject({ status: "accepted" });
  }

  it("kostnadsräkningsflödet och slutregleringen köas som anrop", () => {
    for (const path of [
      "billingRun.createKostnadsrakning", "billingRun.voidKostnadsrakning", "billingRun.recordKostnadsrakningBeslut",
      "billingRun.appealKostnadsrakning", "billingRun.setVerdict", "billingRun.settleCoverage", "billingRun.recordInsurerPruning",
    ]) expect(isQueuedProcedure(path)).toBe(true);
  });

  it("inskick → beslut → faktura efter dom: id:n och datum är desamma som i klientens körning", async () => {
    const { matterId, entryId } = await matterWithWork("OFFENTLIGT_UPPDRAG");
    const submit = call("billingRun.createKostnadsrakning", { matterId });
    await accepted(submit);
    const runId = derivedId(submit.mutationId, "billingRun");
    const run = await repos.billingRuns.getById(asId<"BillingRunId">(runId));
    // KR-referensen i det år anropet gjordes.
    expect(run).toMatchObject({ type: "KOSTNADSRAKNING", kostnadsrakningStatus: "INSKICKAD", reference: expect.stringMatching(/^KR-2025-/) });
    const frozen = await repos.timeEntries.getById(asId<"TimeEntryId">(entryId));
    expect(frozen).toMatchObject({ frozenByBillingRunId: runId });
    expect(new Date(String(frozen?.frozenAt)).getTime()).toBe(MADE_AT);

    // Faktura före beslut → regeln gäller på servern.
    expect(await replayer.replay(call("billingRun.setVerdict", { billingRunId: runId }), ctx)).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });

    await accepted(call("billingRun.recordKostnadsrakningBeslut", { billingRunId: runId, awardedOre: 200_000, prutningOre: -20_000 }));
    const verdict = call("billingRun.setVerdict", { billingRunId: runId });
    await accepted(verdict);
    const invoice = await repos.invoices.getById(asId<"InvoiceId">(derivedId(verdict.mutationId, "invoice")));
    expect(invoice).toMatchObject({ invoiceType: "FINAL", invoiceNumber: expect.stringMatching(/^F-2025-/) });
    expect(new Date(String(invoice?.invoiceDate)).getTime()).toBe(MADE_AT);
    expect(await repos.expenses.getById(asId<"ExpenseId">(derivedId(verdict.mutationId, "prutning")))).toMatchObject({ amount: -20_000, kind: "PRUTNING" });
  });

  it("överklagande och ångrat inskick körs om", async () => {
    const { matterId, entryId } = await matterWithWork("OFFENTLIGT_UPPDRAG");
    const submit = call("billingRun.createKostnadsrakning", { matterId });
    await accepted(submit);
    const runId = derivedId(submit.mutationId, "billingRun");
    await accepted(call("billingRun.voidKostnadsrakning", { billingRunId: runId }));
    expect(await repos.billingRuns.getById(asId<"BillingRunId">(runId))).toMatchObject({ status: "VOIDED" });
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(entryId))).toMatchObject({ frozenByBillingRunId: null });

    const again = call("billingRun.createKostnadsrakning", { matterId });
    await accepted(again);
    const second = derivedId(again.mutationId, "billingRun");
    await accepted(call("billingRun.recordKostnadsrakningBeslut", { billingRunId: second, awardedOre: 100_000, prutningOre: -5_000 }));
    await accepted(call("billingRun.appealKostnadsrakning", { billingRunId: second }));
    expect(await repos.billingRuns.getById(asId<"BillingRunId">(second))).toMatchObject({ kostnadsrakningStatus: "OVERKLAGAD" });
  });

  it("slutreglering (rättsskydd) och försäkringens prutning: fakturorna och körningarna får härledda id:n", async () => {
    const { matterId } = await matterWithWork("RATTSSKYDD", { clientShareBips: 2000 });
    const settle = call("billingRun.settleCoverage", { matterId, payerRecipient: "FORSAKRING" });
    await accepted(settle);
    const clientInvoice = await repos.invoices.getById(asId<"InvoiceId">(derivedId(settle.mutationId, "clientInvoice")));
    const payerInvoice = await repos.invoices.getById(asId<"InvoiceId">(derivedId(settle.mutationId, "payerInvoice")));
    expect(clientInvoice).toMatchObject({ invoiceNumber: expect.stringMatching(/^F-2025-/) });
    expect(new Date(String(payerInvoice?.invoiceDate)).getTime()).toBe(MADE_AT);
    expect(await repos.billingRuns.getById(asId<"BillingRunId">(derivedId(settle.mutationId, "clientRun")))).toMatchObject({ recipient: "KLIENT" });
    expect(await repos.billingRuns.getById(asId<"BillingRunId">(derivedId(settle.mutationId, "payerRun")))).toMatchObject({ recipient: "FORSAKRING" });

    await accepted(call("billingRun.recordInsurerPruning", { matterId, prunedNetOre: 10_000 }));
    const after = await repos.invoices.getById(asId<"InvoiceId">(derivedId(settle.mutationId, "payerInvoice")));
    expect(after?.amount).toBe((payerInvoice?.amount ?? 0) - 12_500);
  });
});
