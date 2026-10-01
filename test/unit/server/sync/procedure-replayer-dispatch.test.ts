/**
 * De sista anropen som skriver procedurägda entiteter (#1242): fakturautskick,
 * avbetalningspåminnelser och Fortnox-markeringen körs om på servern.
 *
 * Det som skyddas:
 *   - utskicket och påminnelserna får SAMMA id som i klientens körning
 *     (härledda ur anropet, eller ur input),
 *   - tidpunkterna (köad, skickad, påminnelsen) är när anropet GJORDES,
 *   - reglerna gäller på servern (fakturan lämnar utkastet, en redan
 *     bokförd faktura bokförs inte om).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { paymentPlanReminders, users } from "@/lib/server/db/schema";
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
/** När anropet gjordes — servern kör om det senare. */
const MADE_AT = Date.UTC(2025, 11, 28, 10, 0);
/** Servern kör om anropet tre dagar senare — inom gränsen för anropstiden (#1350). */
const REPLAYED_AT = MADE_AT + 3 * 86_400_000;

describe("utskick, påminnelser och Fortnox i procedur-kön (#1242)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let ctx: Context;
  let matterId = "";

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos, QUEUE_POLICY, () => REPLAYED_AT);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Utskick", status: "ACTIVE", matterNumber: "2025-1242" } as never);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(MADE_AT), path, input, codeVersion: "test", enqueuedAt: MADE_AT, touches: [] };
  }
  async function invoice(status: string): Promise<string> {
    const id = uuidv7();
    await repos.invoices.create({ id, matterId, amount: 100_000, invoiceDate: new Date("2025-11-01"), status, invoiceNumber: `F-2025-${id.slice(-4)}` } as never);
    return id;
  }
  async function accepted(c: QueuedProcedureCall): Promise<void> {
    expect(await replayer.replay(c, ctx)).toMatchObject({ status: "accepted" });
  }
  const at = (v: unknown): number => new Date(String(v)).getTime();

  it("utskick, påminnelser och Fortnox-markeringen köas som anrop", () => {
    for (const path of [
      "invoiceDispatch.queue", "invoiceDispatch.recordManual", "invoiceDispatch.updateStatus",
      "paymentPlan.recordReminder", "paymentPlan.scanDueReminders", "invoice.markFortnoxBooked",
    ]) expect(isQueuedProcedure(path)).toBe(true);
  });

  it("queue: utskicket får härlett id och anropets tid, och fakturan lämnar utkastet", async () => {
    const inv = await invoice("DRAFT");
    const c = call("invoiceDispatch.queue", { invoiceId: inv, channel: "email", recipient: "klient@exempel.se" });
    await accepted(c);
    const dispatch = await repos.invoiceDispatches.getById(asId<"InvoiceDispatchId">(derivedId(c.mutationId, "invoiceDispatch")));
    expect(dispatch).toMatchObject({ invoiceId: inv, status: "queued", recipient: "klient@exempel.se" });
    expect(at(dispatch?.queuedAt)).toBe(MADE_AT);
    expect(await repos.invoices.getById(asId<"InvoiceId">(inv))).toMatchObject({ status: "SENT" });
  });

  it("recordManual och updateStatus: skickat och levererat dateras när anropen gjordes", async () => {
    const inv = await invoice("SENT");
    const manual = call("invoiceDispatch.recordManual", { invoiceId: inv, channel: "manual", recipient: "Klienten" });
    await accepted(manual);
    const dispatchId = derivedId(manual.mutationId, "invoiceDispatch");
    const sent = await repos.invoiceDispatches.getById(asId<"InvoiceDispatchId">(dispatchId));
    expect(sent).toMatchObject({ status: "sent" });
    expect(at(sent?.sentAt)).toBe(MADE_AT);

    await accepted(call("invoiceDispatch.updateStatus", { dispatchId, status: "delivered" }));
    const delivered = await repos.invoiceDispatches.getById(asId<"InvoiceDispatchId">(dispatchId));
    expect(delivered).toMatchObject({ status: "delivered" });
    expect(at(delivered?.deliveredAt)).toBe(MADE_AT);
  });

  it("recordReminder: påminnelsen får id ur input och anropets tid", async () => {
    const inv = await invoice("INSTALLMENT_PLAN");
    const planId = uuidv7();
    await repos.paymentPlans.create({ id: planId, invoiceId: inv, monthlyAmount: 10_000, dayOfMonth: 25, startDate: new Date("2025-11-01"), status: "ACTIVE" } as never);
    const id = uuidv7();
    await accepted(call("paymentPlan.recordReminder", { id, planId, dueMonth: "2025-12", type: "DUE" }));
    const row = (await handle.db.select().from(paymentPlanReminders)).find((r) => r.id === id);
    expect(row).toMatchObject({ planId, dueMonth: "2025-12", type: "DUE" });
    expect(at(row?.sentAt)).toBe(MADE_AT);
  });

  it("scanDueReminders utan input: påminnelsen gäller månaden när anropet gjordes och får härlett id", async () => {
    const inv = await invoice("INSTALLMENT_PLAN");
    const planId = uuidv7();
    await repos.paymentPlans.create({ id: planId, invoiceId: inv, monthlyAmount: 10_000, dayOfMonth: 25, startDate: new Date("2025-12-01"), status: "ACTIVE" } as never);
    const scan = call("paymentPlan.scanDueReminders", {});
    await accepted(scan);
    const row = (await handle.db.select().from(paymentPlanReminders))
      .find((r) => r.id === derivedId(scan.mutationId, `reminder:${planId}:2025-12:DUE`));
    expect(row).toMatchObject({ planId, dueMonth: "2025-12", type: "DUE" });
    expect(at(row?.sentAt)).toBe(MADE_AT);
    // En andra genomgång samma dag skapar ingen påminnelse till.
    await accepted(call("paymentPlan.scanDueReminders", {}));
    expect((await handle.db.select().from(paymentPlanReminders)).filter((r) => r.planId === planId)).toHaveLength(1);
  });

  it("markFortnoxBooked: sätter Fortnox-id en gång — en redan bokförd faktura skrivs inte över", async () => {
    const inv = await invoice("SENT");
    await accepted(call("invoice.markFortnoxBooked", { invoiceId: inv, fortnoxId: "FX-1" }));
    await accepted(call("invoice.markFortnoxBooked", { invoiceId: inv, fortnoxId: "FX-2" }));
    expect(await repos.invoices.getById(asId<"InvoiceId">(inv))).toMatchObject({ fortnoxId: "FX-1" });
  });
});
