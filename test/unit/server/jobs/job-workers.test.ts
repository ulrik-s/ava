/**
 * Worker-registreringen (#1900), PG-fritt: `registerWorkers` mot en fejkad
 * pg-boss. Varje kö med handler får en worker; en gammal kö får efterträdarens
 * handler, så att jobb som redan ligger där körs klart.
 */

import type { Job } from "pg-boss";
import { describe, expect, it } from "vitest-compat";
import { JOB_QUEUES, RETIRED_JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { type JobHandlers, type WorkBoss, registerWorkers } from "@/lib/server/jobs/job-worker-runtime";

/** Fejkad pg-boss som sparar workern per könamn. */
function fakeBoss() {
  const workers = new Map<string, (jobs: Job[]) => Promise<void>>();
  const boss: WorkBoss = {
    work: (name, handler) => {
      workers.set(name, handler);
      return Promise.resolve(`w-${name}`);
    },
  };
  return { boss, workers };
}

const job = (name: string, data: object): Job => ({
  id: `j-${name}`, name, data, expireInSeconds: 900, heartbeatSeconds: null, retryCount: 0, signal: new AbortController().signal,
});

describe("registerWorkers", () => {
  it("ett gammalt namn får efterträdarens handler; varje jobb i batchen körs", async () => {
    const ran: Array<[string, unknown]> = [];
    const handlers: JobHandlers = {
      [JOB_QUEUES.emailDispatch]: (j) => { ran.push(["email", j.data]); return Promise.resolve(); },
    };
    const { boss, workers } = fakeBoss();
    await registerWorkers(boss, handlers);
    expect([...workers.keys()].sort()).toEqual(["email-dispatch", JOB_QUEUES.emailDispatch].sort());
    await workers.get("email-dispatch")?.([job("email-dispatch", { to: "a" }), job("email-dispatch", { to: "b" })]);
    await workers.get(JOB_QUEUES.emailDispatch)?.([job(JOB_QUEUES.emailDispatch, { to: "c" })]);
    expect(ran).toEqual([["email", { to: "a" }], ["email", { to: "b" }], ["email", { to: "c" }]]);
  });

  it("en kö utan handler får ingen worker, och inte heller ett gammalt namn vars efterträdare saknar handler", async () => {
    const { boss, workers } = fakeBoss();
    await registerWorkers(boss, { [JOB_QUEUES.indexDocument]: () => Promise.resolve() });
    expect([...workers.keys()]).toEqual([JOB_QUEUES.indexDocument]);
    for (const old of Object.keys(RETIRED_JOB_QUEUES)) expect(workers.has(old)).toBe(false);
  });

  it("alla handlers → en worker per kö och per gammal kö", async () => {
    const noop = (): Promise<void> => Promise.resolve();
    const all: JobHandlers = Object.fromEntries(Object.values(JOB_QUEUES).map((n) => [n, noop]));
    const { boss, workers } = fakeBoss();
    await registerWorkers(boss, all);
    expect(workers.size).toBe(Object.values(JOB_QUEUES).length + Object.keys(RETIRED_JOB_QUEUES).length);
  });
});
