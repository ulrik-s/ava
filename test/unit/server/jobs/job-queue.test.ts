/**
 * Server-sidig jobb-kö (pg-boss, #504). Två nivåer:
 *   - alltid: kö-namnen, policy och gamla köer (ren konfig), och `startJobQueue`
 *     mot en fejkad boss (#1900).
 *   - PG-gated (`PG_TEST_URL`, CI:s Postgres-jobb): RIKTIG round-trip mot pg-boss
 *     — start (skapar pgboss-schemat) → send → work → handlern får payloaden —
 *     och köernas dubblettstopp (#1900).
 *     Hoppas lokalt utan Postgres (pglite kan inte köra pg-boss advisory-locks).
 */

import type { Queue } from "pg-boss";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vitest-compat";
import {
  JOB_QUEUE_OPTIONS, JOB_QUEUES, QUEUED_JOB_RETENTION_SECONDS, RETIRED_JOB_QUEUES,
  type QueueBoss, createJobQueue, startJobQueue,
} from "@/lib/server/jobs/job-queue";
import { QueueBackedEmailSender } from "@/lib/server/jobs/queue-backed-email-sender";
import { uuidv7 } from "@/lib/shared/uuid";

const url = process.env.PG_TEST_URL;
const itPg = url ? it : it.skip;

describe("job-queue — konfig", () => {
  it("har distinkta kö-namn", () => {
    const names = Object.values(JOB_QUEUES);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("email-dispatch-v2");
    expect(names).toContain("classify-document-v2");
  });

  it("de gamla köerna finns inte i JOB_QUEUES men pekar på en kö där", () => {
    const names: string[] = Object.values(JOB_QUEUES);
    for (const [old, next] of Object.entries(RETIRED_JOB_QUEUES)) {
      expect(names).not.toContain(old);
      expect(names).toContain(next);
    }
  });

  it("e-postkön är exclusive och klassningskön stately, båda med 14 dagars retention", () => {
    expect(QUEUED_JOB_RETENTION_SECONDS).toBe(14 * 24 * 60 * 60);
    expect(JOB_QUEUE_OPTIONS[JOB_QUEUES.emailDispatch]).toEqual({ policy: "exclusive", retentionSeconds: QUEUED_JOB_RETENTION_SECONDS });
    expect(JOB_QUEUE_OPTIONS[JOB_QUEUES.classifyDocument]).toEqual({ policy: "stately", retentionSeconds: QUEUED_JOB_RETENTION_SECONDS });
  });
});

describe("startJobQueue — fejkad boss (#1900)", () => {
  it("startar och skapar varje kö en gång med sina optioner, och varje gammal kö med bara retry", async () => {
    const created = new Map<string, Omit<Queue, "name"> | undefined>();
    let started = 0;
    const boss: QueueBoss = {
      start: () => { started++; return Promise.resolve(); },
      createQueue: (name, options) => {
        expect(created.has(name)).toBe(false);
        created.set(name, options);
        return Promise.resolve();
      },
    };
    await startJobQueue(boss, 3);
    expect(started).toBe(1);
    const current = Object.values(JOB_QUEUES);
    const retired = Object.keys(RETIRED_JOB_QUEUES);
    expect(created.size).toBe(current.length + retired.length);
    for (const name of current) {
      expect(created.get(name)).toEqual({ retryLimit: 3, retryBackoff: true, ...JOB_QUEUE_OPTIONS[name] });
    }
    for (const name of retired) expect(created.get(name)).toEqual({ retryLimit: 3, retryBackoff: true });
    expect(created.get(JOB_QUEUES.indexDocument)).toEqual({ retryLimit: 3, retryBackoff: true });
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

describe("job-queue — köernas dubblettstopp (PG_TEST_URL, #1900)", () => {
  let schema = "";
  afterEach(async () => {
    if (!url || !schema) return;
    const c = postgres(url, { max: 1, onnotice: () => {} });
    await c.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await c.end();
    schema = "";
  });

  /** En startad boss i ett eget testschema; stängs efter `fn`. */
  async function withBoss(fn: (boss: ReturnType<typeof createJobQueue>) => Promise<void>): Promise<void> {
    schema = `pgboss_test_${uuidSchemaSuffix()}`;
    const boss = createJobQueue({ connectionString: url ?? "", schema });
    boss.on("error", () => {});
    try {
      await startJobQueue(boss);
      await fn(boss);
    } finally {
      await boss.stop({ graceful: false });
    }
  }

  const queuedCount = async (boss: ReturnType<typeof createJobQueue>, name: string): Promise<number> =>
    (await boss.findJobs(name)).length;

  itPg("email-dispatch-v2: samma nyckel två gånger → andra send ger null, ett jobb", async () => {
    await withBoss(async (boss) => {
      expect(await boss.send(JOB_QUEUES.emailDispatch, { to: "a@x.se" }, { singletonKey: "org-1:k" })).toBeTruthy();
      expect(await boss.send(JOB_QUEUES.emailDispatch, { to: "a@x.se" }, { singletonKey: "org-1:k" })).toBeNull();
      expect(await queuedCount(boss, JOB_QUEUES.emailDispatch)).toBe(1);
    });
  }, 60_000);

  itPg("två mejl utan nyckel via porten ger två jobb", async () => {
    await withBoss(async (boss) => {
      const sender = new QueueBackedEmailSender(() => boss, "org-1");
      await sender.send({ to: "a@x.se", subject: "s", text: "t" });
      await sender.send({ to: "a@x.se", subject: "s", text: "t" });
      expect(await queuedCount(boss, JOB_QUEUES.emailDispatch)).toBe(2);
    });
  }, 60_000);

  itPg("classify-document-v2: två send ger ett köat jobb; när det är aktivt godtas ett till", async () => {
    await withBoss(async (boss) => {
      const q = JOB_QUEUES.classifyDocument;
      expect(await boss.send(q, { documentId: "d1" }, { singletonKey: "d1" })).toBeTruthy();
      expect(await boss.send(q, { documentId: "d1" }, { singletonKey: "d1" })).toBeNull();
      expect(await queuedCount(boss, q)).toBe(1);
      const [active] = await boss.fetch(q);
      expect(active).toBeTruthy();
      expect(await boss.send(q, { documentId: "d1" }, { singletonKey: "d1" })).toBeTruthy();
      expect(await queuedCount(boss, q)).toBe(2);
    });
  }, 60_000);

  itPg("getQueue: v2-köerna har sin policy och 14 dagars retention", async () => {
    await withBoss(async (boss) => {
      const email = await boss.getQueue(JOB_QUEUES.emailDispatch);
      const classify = await boss.getQueue(JOB_QUEUES.classifyDocument);
      expect([email?.policy, email?.retentionSeconds]).toEqual(["exclusive", QUEUED_JOB_RETENTION_SECONDS]);
      expect([classify?.policy, classify?.retentionSeconds]).toEqual(["stately", QUEUED_JOB_RETENTION_SECONDS]);
    });
  }, 60_000);
});

/** Schema-säkert unikt suffix (hex) för isolerat pgboss-testschema. */
function uuidSchemaSuffix(): string {
  return uuidv7().replace(/-/g, "");
}
