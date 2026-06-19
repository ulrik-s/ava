/**
 * `QueueBackedEmailSender` (#504 Fas 3) — IEmailSender-porten som köar mejlet på
 * pg-boss. Rena enhetstester (ingen Postgres): send köar ett email-dispatch-jobb
 * med rätt payload; saknad boss → tydligt fel; lazy getter läses per send.
 */

import type { PgBoss } from "pg-boss";
import { describe, it, expect, vi } from "vitest-compat";
import { JOB_QUEUES } from "@/lib/server/jobs/job-queue";
import { QueueBackedEmailSender } from "@/lib/server/jobs/queue-backed-email-sender";

function fakeBoss() {
  const send = vi.fn(async () => "job-1");
  return { boss: { send } as unknown as PgBoss, send };
}

describe("QueueBackedEmailSender", () => {
  it("köar ett email-dispatch-jobb med {to,subject,text} (utan nyckel → inga options)", async () => {
    const { boss, send } = fakeBoss();
    const sender = new QueueBackedEmailSender(() => boss);
    await sender.send({ to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat.", html: "<p>ignoreras</p>" });
    expect(send).toHaveBeenCalledWith(
      JOB_QUEUES.emailDispatch,
      { to: "domstol@ex.se", subject: "Faktura F-1", text: "Bifogat." },
      {},
    );
  });

  it("idempotensnyckel → pg-boss singletonKey (dedupe vid replay/dubbel-trigger)", async () => {
    const { boss, send } = fakeBoss();
    const sender = new QueueBackedEmailSender(() => boss);
    await sender.send({ to: "x@y.se", subject: "s", text: "t", idempotencyKey: "invoice-42" });
    expect(send).toHaveBeenCalledWith(
      JOB_QUEUES.emailDispatch,
      { to: "x@y.se", subject: "s", text: "t" },
      { singletonKey: "invoice-42" },
    );
  });

  it("kastar tydligt när kön inte är redo (ingen boss)", async () => {
    const sender = new QueueBackedEmailSender(() => null);
    await expect(sender.send({ to: "x@y.se", subject: "s", text: "t" })).rejects.toThrow(/kön är inte redo/);
  });

  it("läser boss lazy per send (redo först efter att kön startat)", async () => {
    const { boss, send } = fakeBoss();
    let current: PgBoss | null = null;
    const sender = new QueueBackedEmailSender(() => current);
    await expect(sender.send({ to: "x@y.se", subject: "s", text: "t" })).rejects.toThrow();
    current = boss; // kön startade
    await sender.send({ to: "x@y.se", subject: "s", text: "t" });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
