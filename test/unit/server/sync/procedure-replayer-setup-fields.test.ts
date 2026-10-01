/**
 * Byrå och setup-fält i procedur-kön (#1345, ADR 0037).
 *
 * Servern kör om köade anrop som den som skickade dem. En klient som skickar
 * egna anrop (inte via UI:t) ska inte kunna:
 *   - skapa tid på en annan byrås ärende eller i en annan byrås användares namn,
 *   - sätta fält servern annars bestämmer: någon annans userId, ett eget
 *     á-pris, en fakturakoppling, ett skapad-datum, ett ärendenummer eller en
 *     status — inte ens som administratör (`setup-fields.ts`).
 * Avvisningen sparas som utfall och ingen rad skrivs.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { Principal } from "@/lib/server/auth/principal";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const LAWYER = uuidv7();
const ADMIN = uuidv7();
const COLLEAGUE = uuidv7();
const FOREIGN_USER = uuidv7();

type Row = Record<string, unknown>;

describe("byrå och setup-fält i procedur-kön (#1345)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let lawyerCtx: Context;
  let adminCtx: Context;
  const matterId = uuidv7();
  const foreignMatter = uuidv7();

  function principal(id: string, role: Principal["role"]): Principal {
    return { id: asId<"UserId">(id), email: `${id}@byra.se`, name: role, role, organizationId: asId<"OrganizationId">(ORG) };
  }

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    const people: Array<[string, string, string]> = [[LAWYER, ORG, "LAWYER"], [ADMIN, ORG, "ADMIN"], [COLLEAGUE, ORG, "LAWYER"], [FOREIGN_USER, OTHER_ORG, "LAWYER"]];
    for (const [id, organizationId, role] of people) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await handle.db.insert(users).values({ id, organizationId, email: `${id}@byra.se`, name: role, role, active: true, version: 1, hourlyRates: { ARBETE: 250_000 } } as any);
    }
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Eget ärende", status: "ACTIVE", matterNumber: "2026-1345" } as never);
    await repos.matters.create({ id: foreignMatter, organizationId: OTHER_ORG, title: "Annan byrå", status: "ACTIVE", matterNumber: "2026-1345" } as never);
    const build = (p: Principal): Context => buildContext({ repos, eventLog: serverFirstEventLog, ports: noopPorts, principal: p });
    lawyerCtx = build(principal(LAWYER, "LAWYER"));
    adminCtx = build(principal(ADMIN, "ADMIN"));
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Row): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(), path, input, codeVersion: "test", enqueuedAt: Date.UTC(2026, 9, 1), touches: [] };
  }
  const timeInput = (id: string, extra: Row = {}): Row => ({ id, matterId, date: "2026-10-01", minutes: 60, description: "Möte", ...extra });
  const expenseInput = (id: string, extra: Row = {}): Row => ({ id, matterId, date: "2026-10-01", amount: 38_000, description: "Tåg", ...extra });

  it("tid utan setup-fält: accepteras, i avsändarens namn och med prislistans á-pris", async () => {
    const id = uuidv7();
    expect(await replayer.replay(call("timeEntry.create", timeInput(id)), lawyerCtx)).toMatchObject({ status: "accepted" });
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toMatchObject({ userId: LAWYER, hourlyRate: 250_000 });
  });

  it("tid på en annan byrås ärende: avvisas (NOT_FOUND), ingen rad", async () => {
    const id = uuidv7();
    const res = await replayer.replay(call("timeEntry.create", timeInput(id, { matterId: foreignMatter })), lawyerCtx);
    expect(res).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toBeNull();
  });

  it.each([
    ["en kollegas userId", { userId: COLLEAGUE }],
    ["en annan byrås användare", { userId: FOREIGN_USER }],
    ["ett eget á-pris", { hourlyRate: 1 }],
    ["en fakturakoppling", { invoiceId: uuidv7() }],
    ["ett skapad-datum", { createdAt: "2020-01-01T00:00:00.000Z" }],
  ])("tid med %s: avvisas (FORBIDDEN) för jurist och admin, ingen rad", async (_label, extra) => {
    for (const ctx of [lawyerCtx, adminCtx]) {
      const id = uuidv7();
      expect(await replayer.replay(call("timeEntry.create", timeInput(id, extra)), ctx)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
      expect(await repos.timeEntries.getById(asId<"TimeEntryId">(id))).toBeNull();
    }
  });

  it.each([
    ["en kollegas userId", { userId: COLLEAGUE }],
    ["en fakturakoppling", { invoiceId: uuidv7() }],
    ["ett skapad-datum", { createdAt: "2020-01-01T00:00:00.000Z" }],
  ])("utlägg med %s: avvisas (FORBIDDEN), ingen rad", async (_label, extra) => {
    const id = uuidv7();
    expect(await replayer.replay(call("expense.create", expenseInput(id, extra)), adminCtx)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect(await repos.expenses.getById(asId<"ExpenseId">(id))).toBeNull();
  });

  it.each([
    ["ett eget ärendenummer", { matterNumber: "2026-0001" }],
    ["en status", { status: "CLOSED" }],
    ["ett skapad-datum", { createdAt: "2020-01-01T00:00:00.000Z" }],
  ])("ärende med %s: avvisas (FORBIDDEN), inget ärende", async (_label, extra) => {
    const id = uuidv7();
    expect(await replayer.replay(call("matter.create", { id, title: "Nytt", ...extra }), adminCtx)).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
    expect(await repos.matters.getById(asId<"MatterId">(id))).toBeNull();
  });

  it("rådgivningsfakturan i en kollegas namn: avvisas (FORBIDDEN)", async () => {
    const res = await replayer.replay(call("invoice.createRadgivning", { matterId, userId: COLLEAGUE }), adminCtx);
    expect(res).toMatchObject({ status: "rejected", code: "FORBIDDEN" });
  });
});
