/**
 * Job-worker-runtime (#504 Fas 2). PG-gated (`PG_TEST_URL`, CI:s Postgres-jobb):
 * `startJobRuntime` startar pg-boss + registrerar workers; ett skickat jobb
 * körs av rätt handler; `stop()` stänger gracefully. Hoppas lokalt utan PG.
 */

import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest-compat";
import { createJobQueue, JOB_QUEUES, startJobQueue } from "@/lib/server/jobs/job-queue";
import { startJobRuntime } from "@/lib/server/jobs/job-worker-runtime";
import { uuidv7 } from "@/lib/shared/uuid";

const url = process.env.PG_TEST_URL;
const itPg = url ? it : it.skip;

describe("job-worker-runtime (PG_TEST_URL)", () => {
  let schema = "";
  afterEach(async () => {
    if (!url || !schema) return;
    const c = postgres(url, { max: 1, onnotice: () => {} });
    await c.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await c.end();
    schema = "";
  });

  itPg("registrerad handler kör ett skickat jobb; stop() stänger", async () => {
    schema = `pgboss_test_${uuidv7().replace(/-/g, "")}`;
    const got: unknown[] = [];
    const rt = await startJobRuntime({
      connectionString: url!,
      schema,
      handlers: { [JOB_QUEUES.emailDispatch]: async (job) => { got.push(job.data); } },
    });
    try {
      // Skicka via en separat boss-instans mot samma schema (som en router skulle).
      const sender = createJobQueue({ connectionString: url!, schema });
      sender.on("error", () => {});
      await startJobQueue(sender);
      await sender.send(JOB_QUEUES.emailDispatch, { to: "domstol@ex.se" });
      await sender.stop({ graceful: false });
      for (let i = 0; i < 100 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
      expect(got).toEqual([{ to: "domstol@ex.se" }]);
    } finally {
      await rt.stop();
    }
  }, 60_000);

  itPg("kö utan handler konsumeras inte (jobbet ligger kvar)", async () => {
    schema = `pgboss_test_${uuidv7().replace(/-/g, "")}`;
    const rt = await startJobRuntime({ connectionString: url!, schema, handlers: {} });
    try {
      const sender = createJobQueue({ connectionString: url!, schema });
      sender.on("error", () => {});
      await startJobQueue(sender);
      const id = await sender.send(JOB_QUEUES.fortnoxSync, { x: 1 });
      await new Promise((r) => setTimeout(r, 1500));
      const job = id ? await sender.getJobById(JOB_QUEUES.fortnoxSync, id) : null;
      // Ingen worker → jobbet är inte completed (created/retry, ej done).
      expect(job?.state).not.toBe("completed");
      await sender.stop({ graceful: false });
    } finally {
      await rt.stop();
    }
  }, 60_000);
});
