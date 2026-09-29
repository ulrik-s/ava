/**
 * Fakturorna i procedur-kön, steg 2c (#1276, ADR 0037) — servern kör om
 * aconto-, slut-, kredit- och rådgivningsfakturor.
 *
 * Det som skyddas:
 *   - körningen, avdragen och rådgivningens tidspost får SAMMA id som i
 *     klientens körning (härledda ur anropet),
 *   - fakturadatum, värderingsdag och frysdatum är när anropet GJORDES —
 *     också fakturanumrets serie (fakturadatumets år, ADR 0012),
 *   - servern tilldelar fakturanumret; klientens var preliminärt (#1243),
 *   - de poster slutfakturan fryser loggas i change_log (#1319) och följer
 *     med i svaret, så andra enheter ser dem låsta,
 *   - reglerna gäller på servern: en redan krediterad faktura krediteras inte
 *     igen, en redan registrerad rådgivningstimme registreras inte igen.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { changeLog, users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const USER = uuidv7();
/** Anropet gjordes på nyårsafton 2025 — servern kör om det i januari 2026. */
const MADE_AT = Date.UTC(2025, 11, 31, 10, 0);

describe("fakturorna i procedur-kön (#1276, steg 2c)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>, touches: Array<{ entity: string; id: string }> = []): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(MADE_AT), path, input, codeVersion: "test", enqueuedAt: MADE_AT, touches };
  }
  async function matter(paymentMethod: string): Promise<string> {
    const id = uuidv7();
    await repos.matters.create({ id, organizationId: ORG, title: "Fakturering", status: "ACTIVE", matterNumber: `2025-${id.slice(-4)}`, paymentMethod } as never);
    return id;
  }
  async function entry(matterId: string): Promise<string> {
    const id = uuidv7();
    await repos.timeEntries.create({ id, matterId, userId: USER, date: new Date("2025-12-01"), minutes: 60, description: "Samtal", hourlyRate: 250_000, billable: true } as never);
    return id;
  }

  it("aconto-, slut-, kredit- och rådgivningsfakturor köas som anrop", () => {
    for (const path of ["billingRun.createAcconto", "billingRun.createFinal", "invoice.createCredit", "invoice.createRadgivning"]) {
      expect(isQueuedProcedure(path)).toBe(true);
    }
  });

  it("createAcconto: fakturan och körningen får klientens id, datum och serie är när anropet gjordes", async () => {
    const m = await matter("PRIVAT");
    const invoiceId = uuidv7();
    const c = call("billingRun.createAcconto", { id: invoiceId, matterId: m, clientShareBips: 10000, amountOre: 125_000 });
    const runId = derivedId(c.mutationId, "billingRun");
    const res = await replayer.replay({ ...c, touches: [{ entity: "invoice", id: invoiceId }, { entity: "billingRun", id: runId }] }, ctx);
    expect(res.status).toBe("accepted");
    const invoice = await repos.invoices.getById(asId<"InvoiceId">(invoiceId));
    expect(new Date(String(invoice?.invoiceDate)).getTime()).toBe(MADE_AT);
    // Serverns nummer, i fakturadatumets serie (2025) — inte omkörningens år.
    expect(invoice?.invoiceNumber).toMatch(/^F-2025-/);
    expect(await repos.billingRuns.getById(asId<"BillingRunId">(runId))).toMatchObject({ invoiceId, type: "ACCONTO" });
    expect(res.rows.map((r) => r.entity)).toEqual(["invoice", "billingRun"]);
  });

  it("createFinal: fryser posterna med anropets datum, loggar dem och drar av acontot med härlett id", async () => {
    const m = await matter("PRIVAT");
    const te = await entry(m);
    const accontoInvoice = uuidv7();
    const accontoCall = call("billingRun.createAcconto", { id: accontoInvoice, matterId: m, clientShareBips: 10000, amountOre: 50_000 });
    await replayer.replay(accontoCall, ctx);
    await repos.invoices.update(asId<"InvoiceId">(accontoInvoice), { status: "SENT" } as never);
    const accontoRun = derivedId(accontoCall.mutationId, "billingRun");

    const finalInvoice = uuidv7();
    const c = call("billingRun.createFinal", { id: finalInvoice, matterId: m, recipient: "KLIENT", deductedBillingRunIds: [accontoRun] });
    const res = await replayer.replay({ ...c, touches: [{ entity: "invoice", id: finalInvoice }, { entity: "timeEntry", id: te }] }, ctx);
    expect(res.status).toBe("accepted");

    const frozen = await repos.timeEntries.getById(asId<"TimeEntryId">(te));
    expect(frozen).toMatchObject({ invoiceId: finalInvoice, frozenByBillingRunId: derivedId(c.mutationId, "billingRun") });
    expect(new Date(String(frozen?.frozenAt)).getTime()).toBe(MADE_AT);
    expect(res.rows).toContainEqual({ entity: "timeEntry", row: expect.objectContaining({ id: te, invoiceId: finalInvoice }) });
    // Frysningen når andra enheter via pull (#1319).
    const logged = (await handle.db.select().from(changeLog)).filter((r) => r.rowId === te).map((r) => r.op);
    expect(logged).toEqual(["create", "update", "update"]);
    const deductionId = derivedId(c.mutationId, `accontoDeduction:${accontoInvoice}`);
    expect(await repos.accontoDeductions.getById(asId<"AccontoDeductionId">(deductionId))).toMatchObject({ finalInvoiceId: finalInvoice, accontoInvoiceId: accontoInvoice });
  });

  it("createCredit: kreditnotan dateras när anropet gjordes; en andra kreditering avvisas", async () => {
    const m = await matter("PRIVAT");
    const original = uuidv7();
    await repos.invoices.create({ id: original, matterId: m, amount: 80_000, invoiceDate: new Date("2025-11-01"), status: "SENT", invoiceNumber: "F-2025-9001" } as never);
    const credit = uuidv7();
    const res = await replayer.replay(call("invoice.createCredit", { id: credit, invoiceId: original }, [{ entity: "invoice", id: credit }, { entity: "invoice", id: original }]), ctx);
    expect(res.status).toBe("accepted");
    const row = await repos.invoices.getById(asId<"InvoiceId">(credit));
    expect(row).toMatchObject({ amount: -80_000, invoiceType: "CREDIT" });
    expect(new Date(String(row?.invoiceDate)).getTime()).toBe(MADE_AT);
    expect(res.rows[1]).toMatchObject({ row: { id: original, status: "CANCELLED" } });

    const again = uuidv7();
    const second = await replayer.replay(call("invoice.createCredit", { id: again, invoiceId: original }, [{ entity: "invoice", id: again }]), ctx);
    expect(second).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
    expect(second.rows).toEqual([{ entity: "invoice", row: { id: again }, deleted: true }]);
  });

  it("createRadgivning: fakturan och den låsta tidsposten får härledda id:n; en andra registrering avvisas", async () => {
    const m = await matter("RATTSHJALP");
    const c = call("invoice.createRadgivning", { matterId: m, invoiceDate: "2025-12-15" });
    const invoiceId = derivedId(c.mutationId, "invoice");
    const entryId = derivedId(c.mutationId, "radgivningEntry");
    const res = await replayer.replay({ ...c, touches: [{ entity: "invoice", id: invoiceId }, { entity: "timeEntry", id: entryId }, { entity: "matter", id: m }] }, ctx);
    expect(res.status).toBe("accepted");
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(entryId))).toMatchObject({ invoiceId, matterId: m });
    expect(res.rows).toContainEqual({ entity: "matter", row: expect.objectContaining({ id: m }) });
    const second = await replayer.replay(call("invoice.createRadgivning", { matterId: m }), ctx);
    expect(second).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
  });
});
