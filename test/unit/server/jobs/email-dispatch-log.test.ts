/**
 * Loggen över skickade mejl (#1901) mot Postgres: pglite lokalt och riktig
 * Postgres i CI:s "Repository (Postgres)"-jobb (`PG_TEST_URL`). En nyckel finns
 * efter `record`, `record` två gånger är ingen ändring, och nyckeln gäller
 * bara sin byrå.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest-compat";
import { emailDispatchLog } from "@/lib/server/db/schema";
import { createDrizzleEmailDispatchLog, type EmailDispatchLog } from "@/lib/server/jobs/email-dispatch-log";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../db/pg-test-db";

const ORG = uuidv7();
const OTHER_ORG = uuidv7();
const KEY = "payment.due:p1:2026-11";

describe("createDrizzleEmailDispatchLog", () => {
  let handle: TestDbHandle;
  let log: EmailDispatchLog;

  beforeAll(async () => {
    handle = await createTestDb();
    log = createDrizzleEmailDispatchLog(buildDrizzleRepositories(handle.db));
  });
  afterAll(async () => { await handle.close(); });

  it("en nyckel saknas först och finns efter record", async () => {
    expect(await log.has(ORG, KEY)).toBe(false);
    await log.record(ORG, KEY);
    expect(await log.has(ORG, KEY)).toBe(true);
  });

  it("record två gånger ger inget fel och en rad", async () => {
    await log.record(ORG, "invoice.sent:i1");
    await log.record(ORG, "invoice.sent:i1");
    const rows = (await handle.db.select().from(emailDispatchLog)).filter((r) => r.idempotencyKey === "invoice.sent:i1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sentAt).toBeInstanceOf(Date);
  });

  it("samma nyckel i en annan byrå påverkas inte", async () => {
    expect(await log.has(OTHER_ORG, KEY)).toBe(false);
    await log.record(OTHER_ORG, KEY);
    expect(await log.has(OTHER_ORG, KEY)).toBe(true);
    expect(await log.has(ORG, KEY)).toBe(true);
  });
});
