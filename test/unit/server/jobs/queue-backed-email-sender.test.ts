/**
 * `QueueBackedEmailSender` (#504 Fas 3) — IEmailSender-porten som köar mejlet på
 * pg-boss. Rena enhetstester (ingen Postgres): send köar ett email-dispatch-v2-jobb
 * med rätt payload och `singletonKey` (#1900); saknad boss → tydligt fel; lazy
 * getter läses per send. Dubblettstoppet mot riktig pg-boss: `job-queue.test.ts`.
 */

import type { PgBoss } from "pg-boss";
import { describe, it, expect, vi } from "vitest-compat";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { QueueBackedEmailSender } from "@/lib/server/jobs/queue-backed-email-sender";

function fakeBoss() {
  const send = vi.fn((_name: string, _data: object, _options: { singletonKey: string }) => Promise.resolve("job-1"));
  return { boss: { send } as unknown as PgBoss, send };
}

describe("QueueBackedEmailSender", () => {
  it("köar på email-dispatch-v2 med {to,subject,text}; utan nyckel får varje mejl en egen slumpad nyckel", async () => {
    const { boss, send } = fakeBoss();
    const sender = new QueueBackedEmailSender(() => boss, "org-1");
    await sender.send({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat.", html: "<p>ignoreras</p>" });
    await sender.send({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat." });
    expect(JOB_QUEUES.emailDispatch).toBe("email-dispatch-v2");
    const calls: Array<[string, object, { singletonKey: string }]> = send.mock.calls;
    expect(calls.map((c) => c[0])).toEqual([JOB_QUEUES.emailDispatch, JOB_QUEUES.emailDispatch]);
    expect(calls[0]?.[1]).toEqual({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat." });
    const keys = calls.map((c) => c[2].singletonKey);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("idempotensnyckel → singletonKey `<byrå>:<nyckel>`; payloaden saknar nyckeln", async () => {
    const { boss, send } = fakeBoss();
    const sender = new QueueBackedEmailSender(() => boss, "org-1");
    await sender.send({ to: "x@y.se", subject: "s", text: "t", idempotencyKey: "payment.due:p1:2026-11" });
    expect(send).toHaveBeenCalledWith(
      JOB_QUEUES.emailDispatch,
      { to: "x@y.se", subject: "s", text: "t" },
      { singletonKey: "org-1:payment.due:p1:2026-11" },
    );
  });

  it("kastar tydligt när kön inte är redo (ingen boss)", async () => {
    const sender = new QueueBackedEmailSender(() => null, "org-1");
    await expect(sender.send({ to: "x@y.se", subject: "s", text: "t" })).rejects.toThrow(/kön är inte redo/);
  });

  it("läser boss lazy per send (redo först efter att kön startat)", async () => {
    const { boss, send } = fakeBoss();
    let current: PgBoss | null = null;
    const sender = new QueueBackedEmailSender(() => current, "org-1");
    await expect(sender.send({ to: "x@y.se", subject: "s", text: "t" })).rejects.toThrow();
    current = boss; // kön startade
    await sender.send({ to: "x@y.se", subject: "s", text: "t" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
