/**
 * `QueueBackedEmailSender` (#504 Fas 3) — `IEmailSender`-porten för server-first
 * som KÖAR mejlet durabelt på pg-boss (`email-dispatch-v2`) i st.f. att skicka det
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
import { DisabledEmailSender, isEmailDisabled } from "@/lib/server/integrations/email/disabled-email-sender";
import type { IEmailSender, SendEmailInput } from "@/lib/server/ports";
import { uuidv7 } from "@/lib/shared/uuid";
import { JOB_QUEUES } from "./job-queue";

export class QueueBackedEmailSender implements IEmailSender {
  constructor(
    private readonly getBoss: () => PgBoss | null,
    private readonly organizationId: string,
  ) {}

  async send(input: SendEmailInput): Promise<void> {
    const boss = this.getBoss();
    if (!boss) throw new Error("jobb-kön är inte redo — e-post kunde inte köas");
    // Idempotens (#504, #1900, ADR 0024): kön är `exclusive`, så `singletonKey`
    // `<byrå>:<idempotensnyckel>` ger som mest ett köat eller pågående mejl per
    // nyckel. Utan nyckel får mejlet en slumpad nyckel, så att mejl utan nyckel
    // inte delar den tomma nyckeln (och stoppar varandra).
    await boss.send(
      JOB_QUEUES.emailDispatch,
      { to: input.to, subject: input.subject, text: input.text },
      { singletonKey: this.singletonKeyFor(input) },
    );
  }

  private singletonKeyFor(input: SendEmailInput): string {
    return input.idempotencyKey ? `${this.organizationId}:${input.idempotencyKey}` : uuidv7();
  }
}

/**
 * E-postporten för server-first. `AVA_EMAIL_DISABLED=1` → vägra i st.f. att köa:
 * köade mejl hade legat kvar i pg-boss och gått iväg den dag SMTP konfigurerades.
 */
export function makeEmailPort(
  getBoss: () => PgBoss | null,
  organizationId: string,
  env: Record<string, string | undefined> = process.env,
): IEmailSender {
  return isEmailDisabled(env) ? new DisabledEmailSender() : new QueueBackedEmailSender(getBoss, organizationId);
}
