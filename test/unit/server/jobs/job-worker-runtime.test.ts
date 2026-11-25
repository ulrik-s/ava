/**
 * Job-worker-runtime (#504 Fas 2). PG-gated (`PG_TEST_URL`, CI:s Postgres-jobb):
 * `startJobRuntime` startar pg-boss + registrerar workers; ett skickat jobb
 * körs av rätt handler; `stop()` stänger gracefully; deklarerade scheman
 * registreras i svensk tid och borttagna försvinner (#1802); en gammal kö utan
 * policy behåller den och töms av efterträdarens handler (#1900). Hoppas lokalt utan PG.
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

  itPg("en gammal email-dispatch utan policy (som i prod) behåller standard och töms av e-posthandlern", async () => {
    schema = `pgboss_test_${uuidv7().replace(/-/g, "")}`;
    const old = createJobQueue({ connectionString: url ?? "", schema });
    old.on("error", () => {});
    await old.start();
    await old.createQueue("email-dispatch", { retryLimit: 5, retryBackoff: true });
    await old.send("email-dispatch", { to: "gammal@ex.se" });
    await old.stop({ graceful: false });

    const got: unknown[] = [];
    const rt = await startJobRuntime({
      connectionString: url ?? "",
      schema,
      handlers: { [JOB_QUEUES.emailDispatch]: (job) => { got.push(job.data); return Promise.resolve(); } },
    });
    try {
      expect((await rt.boss.getQueue("email-dispatch"))?.policy).toBe("standard");
      for (let i = 0; i < 100 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 100));
      expect(got).toEqual([{ to: "gammal@ex.se" }]);
    } finally {
      await rt.stop();
    }
  }, 60_000);

  itPg("schemat registreras i svensk tid, tål en andra start och tas bort ur listan", async () => {
    schema = `pgboss_test_${uuidv7().replace(/-/g, "")}`;
    const handlers = { [JOB_QUEUES.rulesTick]: async () => {} };
    const schedules = [{ queue: JOB_QUEUES.rulesTick, cron: "0 3 * * *" }] as const;
    const start = (list: typeof schedules | []) =>
      startJobRuntime({ connectionString: url ?? "", schema, handlers, schedules: list });
    const names = async (rt: Awaited<ReturnType<typeof start>>) =>
      (await rt.boss.getSchedules()).map((s) => [s.name, s.timezone]);
    for (let i = 0; i < 2; i++) {
      const rt = await start(schedules);
      try {
        expect(await names(rt)).toEqual([["rules-tick", "Europe/Stockholm"]]);
      } finally {
        await rt.stop();
      }
    }
    const rt = await start([]);
    try {
      expect(await names(rt)).toEqual([]);
    } finally {
      await rt.stop();
    }
  }, 60_000);
});
