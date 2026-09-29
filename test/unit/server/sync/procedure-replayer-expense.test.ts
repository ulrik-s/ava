/**
 * Utläggen i procedur-kön (#1276, ADR 0037) — servern kör om `expense.*`.
 *
 * Förr gick utläggen via radkön: servern sparade raden klienten skickade.
 * Nu körs routern om på servern, som den som skickade anropet. Reglerna som
 * gäller då:
 *   - ett utlägg skapas bara i den egna byråns ärende,
 *   - ett låst utlägg (fakturerat eller fryst av en körning) går varken att
 *     ändra eller radera — samma regel som för tidsposterna,
 *   - en kollegas radering vinner över en offline-ändring (ingen återuppståndelse).
 * Svaret bär de berörda raderna — alla berörda entiteter, inte bara
 * procedurens egen (faktureringen skriver flera, #1276), och bara inom byrån.
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
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const USER = uuidv7();

describe("utläggen i procedur-kön (#1276)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let matterId = "";
  let foreignMatter = "";
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    matterId = uuidv7(); foreignMatter = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Utläggsärende", status: "ACTIVE", matterNumber: "2026-1276" } as never);
    await repos.matters.create({ id: foreignMatter, organizationId: OTHER_ORG, title: "Annan byrå", status: "ACTIVE", matterNumber: "2026-1276" } as never);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>, touches: Array<{ entity: string; id: string }> = []): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(), path, input, codeVersion: "test", enqueuedAt: 0, touches };
  }
  const expenseInput = (id: string, extra: Record<string, unknown> = {}) => ({
    id, matterId, date: "2026-09-01", amount: 38_000, description: "Tåg till tingsrätten", ...extra,
  });
  async function lockedExpense(): Promise<string> {
    const id = uuidv7();
    await repos.expenses.create({ id, matterId, userId: USER, date: new Date("2026-06-01"), amount: 38_000, description: "Fakturerad resa", billable: true, invoiceId: uuidv7(), frozenAt: new Date("2026-06-30") } as never);
    return id;
  }

  it("expense.create/update/delete köas som anrop", () => {
    expect(["expense.create", "expense.update", "expense.delete"].every(isQueuedProcedure)).toBe(true);
  });

  it("create körs om: samma id, användaren som skickade anropet, raden i svaret", async () => {
    const id = uuidv7();
    const res = await replayer.replay(call("expense.create", expenseInput(id), [{ entity: "expense", id }]), ctx);
    expect(res.status).toBe("accepted");
    expect(await repos.expenses.getById(asId<"ExpenseId">(id))).toMatchObject({ id, userId: USER, amount: 38_000 });
    expect(res.rows).toEqual([{ entity: "expense", row: expect.objectContaining({ id, amount: 38_000 }) }]);
  });

  it("create i en annan byrås ärende → avvisas (NOT_FOUND), inget skapas", async () => {
    const id = uuidv7();
    const res = await replayer.replay(call("expense.create", expenseInput(id, { matterId: foreignMatter }), [{ entity: "expense", id }]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(await repos.expenses.getById(asId<"ExpenseId">(id))).toBeNull();
  });

  it("ändra ett låst utlägg → avvisas med regelns meddelande, utlägget orört", async () => {
    const id = await lockedExpense();
    const res = await replayer.replay(call("expense.update", { id, amount: 1 }, [{ entity: "expense", id }]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "PRECONDITION_FAILED" });
    expect((await repos.expenses.getById(asId<"ExpenseId">(id)))?.amount).toBe(38_000);
    expect(res.rows).toEqual([{ entity: "expense", row: expect.objectContaining({ id, amount: 38_000 }) }]);
  });

  it("radera ett låst utlägg → avvisas, utlägget finns kvar", async () => {
    const id = await lockedExpense();
    const res = await replayer.replay(call("expense.delete", { id }, [{ entity: "expense", id }]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "PRECONDITION_FAILED" });
    expect(await repos.expenses.getById(asId<"ExpenseId">(id))).not.toBeNull();
  });

  it("en kollegas radering vinner: ändringen avvisas och svaret är en tombstone", async () => {
    const id = uuidv7();
    await replayer.replay(call("expense.create", expenseInput(id), [{ entity: "expense", id }]), ctx);
    await repos.expenses.hardDelete(asId<"ExpenseId">(id));
    const res = await replayer.replay(call("expense.update", { id, amount: 50_000 }, [{ entity: "expense", id }]), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(res.rows).toEqual([{ entity: "expense", row: { id }, deleted: true }]);
    expect(await repos.expenses.getById(asId<"ExpenseId">(id))).toBeNull();
  });

  it("svaret bär ALLA berörda entiteter inom byrån, och en annan byrås rad som tombstone", async () => {
    const id = uuidv7();
    const ownEntry = uuidv7();
    await repos.timeEntries.create({ id: ownEntry, matterId, userId: USER, date: new Date("2026-09-01"), minutes: 30, description: "Samtal", billable: true, hourlyRate: 150_000 } as never);
    const foreignEntry = uuidv7();
    await repos.timeEntries.create({ id: foreignEntry, matterId: foreignMatter, userId: uuidv7(), date: new Date("2026-09-01"), minutes: 30, description: "Deras", billable: true, hourlyRate: 150_000 } as never);
    const res = await replayer.replay(call("expense.create", expenseInput(id), [
      { entity: "expense", id }, { entity: "timeEntry", id: ownEntry }, { entity: "timeEntry", id: foreignEntry },
    ]), ctx);
    expect(res.rows).toContainEqual({ entity: "expense", row: expect.objectContaining({ id }) });
    expect(res.rows).toContainEqual({ entity: "timeEntry", row: expect.objectContaining({ id: ownEntry }) });
    expect(res.rows).toContainEqual({ entity: "timeEntry", row: { id: foreignEntry }, deleted: true });
  });
});
