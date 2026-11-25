/**
 * "Flytta tidspost till annat ärende" i procedur-kön (#2042, ADR 0037).
 *
 * Tidsposter är procedurägda: servern tar inte emot dem som färdiga rader, så
 * flytten köas som anrop och körs om på servern. Det som skyddas:
 *   - posten byter ärende och timpriset räknas mot serverns priser för målet,
 *   - samma anrop en gång till ger samma utfall,
 *   - låsregeln gäller på servern: en fakturerad post avvisas.
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
const USER = uuidv7();
const MADE_AT = Math.floor((Date.now() - 86_400_000) / 1000) * 1000;

describe("Flytta tidspost i procedur-kön (#2042)", () => {
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

  function call(input: Record<string, unknown>): QueuedProcedureCall {
    return { type: "procedure", mutationId: uuidv7(MADE_AT), path: "timeEntry.moveToMatter", input, codeVersion: "test", enqueuedAt: MADE_AT, touches: [] };
  }

  async function newMatter(hourlyRates: Record<string, number> = {}): Promise<string> {
    const matterId = uuidv7();
    await repos.matters.create({
      id: matterId, organizationId: ORG, title: "Ärende", status: "ACTIVE", matterNumber: `2026-${matterId.slice(-4)}`,
      paymentMethod: "LOPANDE", hourlyRates,
    } as never);
    return matterId;
  }

  async function newEntry(matterId: string, extra: Record<string, unknown> = {}): Promise<string> {
    const entryId = uuidv7();
    await repos.timeEntries.create({
      id: entryId, matterId, userId: USER, date: new Date("2026-03-02"), minutes: 30, description: "Samtal",
      hourlyRate: 100_000, billable: true, kind: "ARBETE", ...extra,
    } as never);
    return entryId;
  }

  it("köas som anrop", () => {
    expect(isQueuedProcedure("timeEntry.moveToMatter")).toBe(true);
  });

  it("posten byter ärende med målärendets pris, och samma anrop igen ger samma utfall", async () => {
    const from = await newMatter();
    const to = await newMatter({ ARBETE: 420_000 });
    const entryId = await newEntry(from);
    const c = call({ ids: [entryId], matterId: to });
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    expect((await replayer.replay(c, ctx)).status).toBe("accepted");
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(entryId))).toMatchObject({ matterId: to, hourlyRate: 420_000, minutes: 30 });
  });

  it("låsregeln gäller på servern: en fakturerad post avvisas och ligger kvar", async () => {
    const from = await newMatter();
    const to = await newMatter();
    const entryId = await newEntry(from, { frozenAt: new Date("2026-04-01") });
    expect(await replayer.replay(call({ ids: [entryId], matterId: to }), ctx)).toMatchObject({ status: "rejected", code: "PRECONDITION_FAILED" });
    expect(await repos.timeEntries.getById(asId<"TimeEntryId">(entryId))).toMatchObject({ matterId: from });
  });
});
