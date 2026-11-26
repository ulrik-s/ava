/**
 * Schemalagda jobb (#1802), PG-fritt: `registerSchedules` mot en fejkad pg-boss.
 * Bara köer med handler schemaläggs (svensk tid, `missed` `once` som standard),
 * odeklarerade eller handler-lösa scheman tas bort, och en andra start ger
 * samma resultat.
 */

import type { Schedule, ScheduleOptions } from "pg-boss";
import { describe, expect, it } from "vitest-compat";
import { JOB_QUEUES, JOB_SCHEDULES, type JobSchedule } from "@/lib/server/jobs/job-queue";
import { type JobHandlers, type ScheduleBoss, registerSchedules } from "@/lib/server/jobs/job-worker-runtime";

interface ScheduleCall { name: string; cron: string; data: object | null | undefined; options: ScheduleOptions | undefined }

/** Fejkad pg-boss som sparar scheman per namn, som pg-boss gör i databasen. */
function fakeBoss(initial: string[] = []) {
  const stored = new Map<string, Schedule>(initial.map((name) => [name, scheduleRow(name, "0 3 * * *")]));
  const scheduled: ScheduleCall[] = [];
  const unscheduled: string[] = [];
  const boss: ScheduleBoss = {
    schedule: (name, cron, data, options) => {
      scheduled.push({ name, cron, data, options });
      stored.set(name, scheduleRow(name, cron));
      return Promise.resolve();
    },
    unschedule: (name) => {
      unscheduled.push(name);
      stored.delete(name);
      return Promise.resolve();
    },
    getSchedules: () => Promise.resolve([...stored.values()]),
  };
  return { boss, stored, scheduled, unscheduled };
}

function scheduleRow(name: string, cron: string): Schedule {
  const now = new Date(0);
  return { name, key: "", kind: "cron", cron, timezone: "Europe/Stockholm", createdOn: now, updatedOn: now, lastJobId: null };
}

const noop = (): Promise<void> => Promise.resolve();
const handlers: JobHandlers = { [JOB_QUEUES.indexDocument]: noop, [JOB_QUEUES.fortnoxSync]: noop };

describe("JOB_SCHEDULES", () => {
  it("schemalägger bokföringens keepalive måndag 03:00 (#1815)", () => {
    expect(JOB_SCHEDULES).toEqual([{ queue: "ledger-keepalive", cron: "0 3 * * 1" }]);
    expect(Object.values(JOB_QUEUES)).toContain("ledger-keepalive");
  });
});

describe("registerSchedules", () => {
  it("registrerar varje schema med handler i svensk tid, missed once som standard", async () => {
    const f = fakeBoss();
    const schedules: JobSchedule[] = [
      { queue: JOB_QUEUES.indexDocument, cron: "0 3 * * *" },
      { queue: JOB_QUEUES.fortnoxSync, cron: "*/15 * * * *", missed: "skip" },
    ];
    await registerSchedules(f.boss, handlers, schedules);
    expect(f.scheduled).toEqual([
      { name: "index-document", cron: "0 3 * * *", data: null, options: { tz: "Europe/Stockholm", missed: "once" } },
      { name: "fortnox-sync", cron: "*/15 * * * *", data: null, options: { tz: "Europe/Stockholm", missed: "skip" } },
    ]);
    expect(f.unscheduled).toEqual([]);
  });

  it("schemalägger inte en kö som saknar handler", async () => {
    const f = fakeBoss();
    await registerSchedules(f.boss, handlers, [{ queue: JOB_QUEUES.emailDispatch, cron: "0 * * * *" }]);
    expect(f.scheduled).toEqual([]);
    expect([...f.stored.keys()]).toEqual([]);
  });

  it("tar bort sparade scheman som är odeklarerade eller saknar handler", async () => {
    const f = fakeBoss(["index-document", "email-dispatch", "borttagen-ko"]);
    const schedules: JobSchedule[] = [
      { queue: JOB_QUEUES.indexDocument, cron: "0 3 * * *" },
      { queue: JOB_QUEUES.emailDispatch, cron: "0 * * * *" },
    ];
    await registerSchedules(f.boss, handlers, schedules);
    expect(f.unscheduled).toEqual(["email-dispatch", "borttagen-ko"]);
    expect([...f.stored.keys()]).toEqual(["index-document"]);
  });

  it("två starter i rad ger samma anrop och samma slutresultat", async () => {
    const f = fakeBoss(["borttagen-ko"]);
    const schedules: JobSchedule[] = [{ queue: JOB_QUEUES.indexDocument, cron: "0 3 * * *" }];
    await registerSchedules(f.boss, handlers, schedules);
    const first = { scheduled: [...f.scheduled], stored: [...f.stored.keys()] };
    f.scheduled.length = 0;
    await registerSchedules(f.boss, handlers, schedules);
    expect(f.scheduled).toEqual(first.scheduled);
    expect([...f.stored.keys()]).toEqual(first.stored);
    expect(f.unscheduled).toEqual(["borttagen-ko"]);
  });
});
