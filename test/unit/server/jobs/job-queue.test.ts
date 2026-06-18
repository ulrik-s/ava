/**
 * Server-sidig jobb-kö (pg-boss, #504). Två nivåer:
 *   - alltid: kö-namnen är distinkta (ren konfig).
 *   - PG-gated (`PG_TEST_URL`, CI:s Postgres-jobb): RIKTIG round-trip mot pg-boss
 *     — start (skapar pgboss-schemat) → send → work → handlern får payloaden.
 *     Hoppas lokalt utan Postgres (pglite kan inte köra pg-boss advisory-locks).
 */

import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest-compat";
import { JOB_QUEUES, createJobQueue, startJobQueue } from "@/lib/server/jobs/job-queue";
import { uuidv7 } from "@/lib/shared/uuid";

const url = process.env.PG_TEST_URL;
const itPg = url ? it : it.skip;

describe("job-queue — konfig", () => {
  it("har distinkta kö-namn", () => {
    const names = Object.values(JOB_QUEUES);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("email-dispatch");
  });
});

describe("job-queue — pg-boss round-trip (PG_TEST_URL)", () => {
  let schema = "";
  afterEach(async () => {
    if (!url || !schema) return;
    const c = postgres(url, { max: 1, onnotice: () => {} });
    await c.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await c.end();
    schema = "";
  });

  itPg("start → send → work levererar jobbet durabelt", async () => {
    schema = `pgboss_test_${uuidSchemaSuffix()}`;
    const boss = createJobQueue({ connectionString: url!, schema });
    boss.on("error", () => {});
    try {
      await startJobQueue(boss);
      const got: unknown[] = [];
      await boss.work(JOB_QUEUES.emailDispatch, async (jobs) => { for (const job of jobs) got.push(job.data); });
      const id = await boss.send(JOB_QUEUES.emailDispatch, { to: "anna@firma.se" });
      expect(id).toBeTruthy();
      for (let i = 0; i < 100 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
      expect(got).toEqual([{ to: "anna@firma.se" }]);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 60_000);
});

/** Schema-säkert unikt suffix (hex) för isolerat pgboss-testschema. */
function uuidSchemaSuffix(): string {
  return uuidv7().replace(/-/g, "");
}
