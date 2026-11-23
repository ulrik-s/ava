/**
 * Förhören i procedur-kön (#1855, ADR 0037) — servern kör om `interrogation.*`.
 *
 * Förhören styr arvodet i ett förordnandemål, så de är procedurägda: servern
 * kör om routern som den som skickade anropet (byrån och reglerna för tider
 * gäller), och tar inte emot färdiga rader från radkön.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedMutation, QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { derivedId } from "@/lib/shared/sync/derived-id";
import { PROCEDURE_OWNED_REASON } from "@/lib/shared/sync/procedure-owned";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";
import { pusher } from "./row-pusher";

const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const USER = uuidv7();
const t = (hhmm: string): string => `2026-10-01T${hhmm}:00.000Z`;

describe("förhören i procedur-kön (#1855)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let sync: DrizzleSyncStore;
  let matterId = "";
  let foreignMatter = "";
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    sync = new DrizzleSyncStore(handle.db, repos);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await handle.db.insert(users).values({ id: USER, organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 } as any);
    matterId = uuidv7(); foreignMatter = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Förordnande", status: "ACTIVE", matterNumber: "2026-1855" } as never);
    await repos.matters.create({ id: foreignMatter, organizationId: OTHER_ORG, title: "Annan byrå", status: "ACTIVE", matterNumber: "2026-1855" } as never);
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: asId<"OrganizationId">(ORG) },
    });
  });
  afterAll(async () => { await handle.close(); });

  function call(path: string, input: Record<string, unknown>, mutationId = uuidv7()): QueuedProcedureCall {
    return { type: "procedure", mutationId, path, input, codeVersion: "test", enqueuedAt: 0, touches: [] };
  }

  /** Skapa ett förhör via kön; id:t härleds ur anropet. */
  async function created(): Promise<string> {
    const mutationId = uuidv7();
    const res = await replayer.replay(call("interrogation.create", { matterId, start: t("08:00"), end: t("10:00"), pauses: [] }, mutationId), ctx);
    expect(res.status).toBe("accepted");
    return derivedId(mutationId, "interrogation");
  }

  it("interrogation.create/update/delete köas som anrop", () => {
    expect(["interrogation.create", "interrogation.update", "interrogation.delete"].every(isQueuedProcedure)).toBe(true);
  });

  it("create körs om: id:t härleds ur anropet, byrån ur den som skickade det", async () => {
    const id = await created();
    expect(await repos.interrogations.getById(asId<"InterrogationId">(id))).toMatchObject({ id, organizationId: ORG, matterId });
  });

  it("create i en annan byrås ärende → avvisas (NOT_FOUND)", async () => {
    const res = await replayer.replay(call("interrogation.create", { matterId: foreignMatter, start: t("08:00"), end: t("09:00"), pauses: [] }), ctx);
    expect(res).toMatchObject({ status: "rejected", code: "NOT_FOUND" });
  });

  it("update körs om och prövar reglerna: uppehåll utanför → BAD_REQUEST, förhöret orört", async () => {
    const id = await created();
    const ok = await replayer.replay(call("interrogation.update", { id, pauses: [{ start: t("09:00"), end: t("09:20") }] }), ctx);
    expect(ok.status).toBe("accepted");
    const bad = await replayer.replay(call("interrogation.update", { id, pauses: [{ start: t("09:50"), end: t("10:30") }] }), ctx);
    expect(bad).toMatchObject({ status: "rejected", code: "BAD_REQUEST" });
    expect((await repos.interrogations.getById(asId<"InterrogationId">(id)))?.pauses).toEqual([{ start: t("09:00"), end: t("09:20") }]);
  });

  it("delete körs om: förhöret tas bort mjukt", async () => {
    const id = await created();
    expect((await replayer.replay(call("interrogation.delete", { id }), ctx)).status).toBe("accepted");
    expect(await repos.interrogations.getById(asId<"InterrogationId">(id))).toBeNull();
  });

  describe("radkön", () => {
    const mut = (kind: QueuedMutation["kind"], row: Record<string, unknown>): QueuedMutation =>
      ({ mutationId: uuidv7(), entity: "interrogation", kind, row, enqueuedAt: 0 });

    it("ett nytt förhör som rad → avvisas med besked, skapas inte", async () => {
      const id = uuidv7();
      const res = await sync.push(pusher(ORG), mut("create", { id, organizationId: ORG, matterId, start: t("08:00"), end: t("09:00"), pauses: [] }));
      expect(res).toMatchObject({ status: "conflict", reason: PROCEDURE_OWNED_REASON });
      expect(await repos.interrogations.getById(asId<"InterrogationId">(id))).toBeNull();
    });

    it("ändrade tider på ett befintligt förhör som rad → avvisas, förhöret orört", async () => {
      const id = await created();
      const res = await sync.push(pusher(ORG), mut("update", { id, organizationId: ORG, matterId, start: t("06:00") }));
      expect(res).toMatchObject({ status: "conflict", reason: PROCEDURE_OWNED_REASON });
      const row = await repos.interrogations.getById(asId<"InterrogationId">(id));
      expect(new Date(row?.start ?? 0).toISOString()).toBe(t("08:00"));
    });
  });
});
