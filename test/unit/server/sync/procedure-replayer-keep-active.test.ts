/**
 * Behåll som aktivt i procedur-kön (#2098), mot Postgres. Ärendet är
 * procedurägt, så datumet skrivs bara när servern kör om anropet — och då med
 * anropets tid, inte serverns.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { buildContext } from "@/lib/server/build-context";
import type { QueuedProcedureCall } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { serverFirstEventLog } from "@/lib/server/http/server-context";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { DrizzleProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { Context } from "@/lib/server/trpc-core";
import { asId } from "@/lib/shared/schemas/ids";
import { isQueuedProcedure } from "@/lib/shared/sync/queued-procedures";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = asId<"OrganizationId">(uuidv7());
const USER = uuidv7();
/** Anropet gjordes i går (hela sekunder, som tidsstämplarna lagras) — servern kör om det nu. */
const MADE_AT = Math.floor((Date.now() - 86_400_000) / 1000) * 1000;

describe("Behåll som aktivt körs om på servern med anropets tid (#2098)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
  let replayer: DrizzleProcedureReplayer;
  let ctx: Context;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    replayer = new DrizzleProcedureReplayer(handle.db, repos);
    await handle.db.insert(users).values({ id: asId<"UserId">(USER), organizationId: ORG, email: "lena@byra.se", name: "Lena", role: "LAWYER", active: true, version: 1 });
    ctx = buildContext({
      repos, eventLog: serverFirstEventLog, ports: noopPorts,
      principal: { id: asId<"UserId">(USER), email: "lena@byra.se", name: "Lena", role: "LAWYER", organizationId: ORG },
    });
  });
  afterAll(async () => { await handle.close(); });

  it("köas som anrop", () => {
    expect(isQueuedProcedure("matter.keepActive")).toBe(true);
  });

  it("servern godtar anropet och kept_active_at blir anropets tid", async () => {
    const id = asId<"MatterId">(uuidv7());
    await repos.matters.create({ id, organizationId: ORG, title: "Tvist", status: "ACTIVE", matterNumber: "2026-0001" });
    const c: QueuedProcedureCall = {
      type: "procedure", mutationId: uuidv7(MADE_AT), path: "matter.keepActive", input: { id }, codeVersion: "test", enqueuedAt: MADE_AT, touches: [],
    };
    expect(await replayer.replay(c, ctx)).toMatchObject({ status: "accepted" });
    const matter = await repos.matters.getByIdInOrg(id, ORG);
    expect(new Date(String(matter?.keptActiveAt)).getTime()).toBe(MADE_AT);
    expect(matter?.status).toBe("ACTIVE");
  });
});
