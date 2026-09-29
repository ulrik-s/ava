/**
 * Faktureringen i procedur-kön, steg 2a (#1276, ADR 0037) — servern kör om
 * betalningar, avskrivningar, statusändringar, avbetalningsplaner och
 * domstolsfordringar.
 *
 * Det som skyddas:
 *   - rader proceduren skapar (betalningen, avskrivningen, anteckningen,
 *     fordran) får SAMMA id som i klientens körning — härlett ur anropets id —
 *     så klientens optimistiska rad och serverns är samma rad,
 *   - affärsdatum som inte står i input är när anropet GJORDES, inte när
 *     servern kör om det (en kö som töms nästa dag),
 *   - reglerna gäller på servern (en övergång som inte är tillåten avvisas,
 *     utan halva skrivningar),
 *   - svaret bär alla berörda rader, oavsett entitet, och bara inom byrån.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { serviceNotes, users } from "@/lib/server/db/schema";
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
const OTHER_ORG = uuidv7();
const USER = uuidv7();
/** När anropet gjordes — långt före omkörningen. */
const MADE_AT = Date.UTC(2026, 0, 15, 10, 0);

describe("faktureringen i procedur-kön (#1276, steg 2a)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let matterId = "";
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Faktureringsärende", status: "ACTIVE", matterNumber: "2026-1276" } as never);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>, touches: Array<{ entity: string; id: string }> = []): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(MADE_AT), path, input, codeVersion: "test", enqueuedAt: MADE_AT, touches };
  }
  async function invoice(status: string, amount = 100_000, inMatter = matterId): Promise<string> {
    const id = uuidv7();
    await repos.invoices.create({ id, matterId: inMatter, amount, invoiceDate: new Date("2026-01-02"), status } as never);
    return id;
  }

  it("betalning, avskrivning, status, avbetalningsplan och domstolsfordringar köas som anrop", () => {
    for (const path of [
      "invoice.recordPayment", "invoice.writeOff", "invoice.setStatus", "invoice.createPaymentPlan",
      "invoice.cancelPaymentPlan", "paymentPlan.cancel", "expectedReceivable.create",
      "expectedReceivable.settle", "expectedReceivable.cancel", "expectedReceivable.update",
    ]) expect(isQueuedProcedure(path)).toBe(true);
  });

  it("recordPayment: betalningen får klientens id, fakturan blir betald, båda raderna i svaret", async () => {
    const inv = await invoice("SENT");
    const c = call("invoice.recordPayment", { invoiceId: inv, amount: 100_000, paidAt: "2026-01-14" });
    const paymentId = derivedId(c.mutationId, "payment");
    const res = await replayer.replay({ ...c, touches: [{ entity: "payment", id: paymentId }, { entity: "invoice", id: inv }] }, ctx);
    expect(res.status).toBe("accepted");
    expect(await repos.payments.getById(asId<"PaymentId">(paymentId))).toMatchObject({ invoiceId: inv, amount: 100_000 });
    expect(res.rows).toEqual([
      { entity: "payment", row: expect.objectContaining({ id: paymentId }) },
      { entity: "invoice", row: expect.objectContaining({ id: inv, status: "PAID" }) },
    ]);
  });

  it("recordPayment på en annullerad faktura avvisas — ingen betalning skapas", async () => {
    const inv = await invoice("CANCELLED");
    const c = call("invoice.recordPayment", { invoiceId: inv, amount: 1_000, paidAt: "2026-01-14" });
    const paymentId = derivedId(c.mutationId, "payment");
    const res = await replayer.replay({ ...c, touches: [{ entity: "payment", id: paymentId }] }, ctx);
    expect(res).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
    // Klientens optimistiska betalning tas bort.
    expect(res.rows).toEqual([{ entity: "payment", row: { id: paymentId }, deleted: true }]);
  });

  it("writeOff utan datum: avskrivningen dateras när anropet gjordes, inte när servern kör om det", async () => {
    const inv = await invoice("SENT");
    const c = call("invoice.writeOff", { invoiceId: inv, reason: "Konkurs" });
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    const writeOff = await repos.writeOffs.getById(asId<"WriteOffId">(derivedId(c.mutationId, "writeOff")));
    expect(writeOff).toMatchObject({ amount: 100_000 });
    expect(new Date(String(writeOff?.writtenOffAt)).getTime()).toBe(MADE_AT);
  });

  it("setStatus: anteckningen får klientens id och anropets datum", async () => {
    const inv = await invoice("SENT");
    const c = call("invoice.setStatus", { invoiceId: inv, status: "CANCELLED" });
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    const noteId = derivedId(c.mutationId, "serviceNote");
    const note = await repos.serviceNotes.getById(asId<"ServiceNoteId">(noteId));
    expect(note).toMatchObject({ matterId, date: "2026-01-15" });
  });

  it("setStatus med en otillåten övergång avvisas — ingen anteckning skrivs", async () => {
    const inv = await invoice("DRAFT");
    const before = (await handle.db.select().from(serviceNotes)).length;
    const c = call("invoice.setStatus", { invoiceId: inv, status: "BAD_DEBT" });
    expect(await replayer.replay(c, ctx)).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
    expect((await handle.db.select().from(serviceNotes)).length).toBe(before);
  });

  it("avbetalningsplan: skapas med klientens id och avbryts; fakturan följer med", async () => {
    const inv = await invoice("SENT");
    const planId = uuidv7();
    const created = await replayer.replay(call("invoice.createPaymentPlan", {
      id: planId, invoiceId: inv, monthlyAmount: 10_000, dayOfMonth: 25, startDate: "2026-02-25",
    }, [{ entity: "paymentPlan", id: planId }, { entity: "invoice", id: inv }]), ctx);
    expect(created.status).toBe("accepted");
    expect(created.rows[1]).toMatchObject({ entity: "invoice", row: { id: inv, status: "INSTALLMENT_PLAN" } });
    const cancelled = await replayer.replay(call("paymentPlan.cancel", { planId }, [{ entity: "paymentPlan", id: planId }]), ctx);
    expect(cancelled.rows).toEqual([{ entity: "paymentPlan", row: expect.objectContaining({ id: planId, status: "CANCELLED" }) }]);
  });

  it("domstolsfordran: skapas med härlett id och pricka av utan datum dateras när anropet gjordes", async () => {
    const c = call("expectedReceivable.create", { matterId, description: "Kostnadsräkning tingsrätten", expectedAmount: 50_000 });
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    const id = derivedId(c.mutationId, "expectedReceivable");
    const settle = call("expectedReceivable.settle", { id, settledAmount: 45_000 }, [{ entity: "expectedReceivable", id }]);
    const res = await replayer.replay(settle, ctx);
    expect(res.rows).toEqual([{ entity: "expectedReceivable", row: expect.objectContaining({ id, status: "SETTLED", settledAmount: 45_000 }) }]);
    const row = await repos.expectedReceivables.getById(asId<"ExpectedReceivableId">(id));
    expect(new Date(String(row?.settledAt)).getTime()).toBe(MADE_AT);
  });

  it("en annan byrås faktura: avvisas, och dess rader blir tombstones i svaret — aldrig data", async () => {
    const foreignMatter = uuidv7();
    await repos.matters.create({ id: foreignMatter, organizationId: OTHER_ORG, title: "Annan byrå", status: "ACTIVE", matterNumber: "2026-9999" } as never);
    const foreign = await invoice("SENT", 7_777, foreignMatter);
    const res = await replayer.replay(call("invoice.setStatus", { invoiceId: foreign, status: "CANCELLED" }, [{ entity: "invoice", id: foreign }]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(res.rows).toEqual([{ entity: "invoice", row: { id: foreign }, deleted: true }]);
    expect(await repos.invoices.getById(asId<"InvoiceId">(foreign))).toMatchObject({ status: "SENT" });
  });

  it("en berörd entitet som inte synkas hoppas över i svaret", async () => {
    const res = await replayer.replay(call("invoice.setStatus", { invoiceId: uuidv7(), status: "SENT" }, [{ entity: "okänd", id: uuidv7() }]), ctx);
    expect(res.rows).toEqual([]);
  });
});
