/**
 * `QueueBackedEmailSender` (#504 Fas 3) — `IEmailSender`-porten för server-first
 * som KÖAR mejlet durabelt på pg-boss (`email-dispatch`) i st.f. att skicka det
 * synkront. `email-dispatch-handler` plockar och skickar via smtp-sender, med
 * pg-boss retry/backoff/dead-letter. Routrar anropar `ctx.ports.email.send(...)`
 * som vanligt — durabiliteten är transparent.
 *
 * Boss:en hämtas lazy (`getBoss`): porten skapas i composition-rooten INNAN
 * jobb-kön startats (best-effort, efter att API:t byggts), så vi får inte hålla
 * en boss-referens vid konstruktion. Saknas boss vid send → tydligt fel
 * (routern returnerar det till anroparen).
 */

import type { PgBoss } from "pg-boss";
import type { IEmailSender, SendEmailInput } from "@/lib/server/ports";
import { JOB_QUEUES } from "./job-queue";

export class QueueBackedEmailSender implements IEmailSender {
  constructor(private readonly getBoss: () => PgBoss | null) {}

  async send(input: SendEmailInput): Promise<void> {
    const boss = this.getBoss();
    if (!boss) throw new Error("jobb-kön är inte redo — e-post kunde inte köas");
    // Idempotens (#504, ADR 0024): om anroparen anger en idempotensnyckel köas
    // den som pg-boss `singletonKey` → en replay/dubbel-trigger med samma nyckel
    // skickar inte mejlet två gånger. Utan nyckel: oförändrat beteende.
    await boss.send(
      JOB_QUEUES.emailDispatch,
      { to: input.to, subject: input.subject, text: input.text },
      input.idempotencyKey ? { singletonKey: input.idempotencyKey } : {},
    );
  }
}
