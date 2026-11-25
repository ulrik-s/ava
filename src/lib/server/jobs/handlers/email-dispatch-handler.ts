/**
 * E-postutskicks-handler (#504 Fas 3) — konsumerar `email-dispatch`-kön och
 * skickar mejlet via en injicerad `EmailSender` (smtp-sender i produktion).
 *
 * pg-boss äger durabiliteten: kastar handlern (SMTP-fel) retry:ar pg-boss med
 * backoff och dead-letter:ar efter `retryLimit`.
 *
 * Idempotens (#1901, ADR 0024 lager 2): bär jobbet byrå + idempotensnyckel
 * frågas byråns logg (`email_dispatch_log`) först. En redan skickad nyckel blir
 * klar utan utskick; annars skickas mejlet och nyckeln skrivs efteråt, medan
 * jobbet fortfarande är aktivt. Utan nyckel (eller utan byrå) skickas mejlet
 * utan att loggen tillfrågas.
 *
 * Payloaden är ett färdigbyggt mejl (`{to,subject,text}`); att BYGGA mejlet ur
 * en faktura hör hemma hos enqueue:aren (routern) — handlern är generisk send.
 * Zod vid parsegränsen (#187): job.data är otypad tills den parsas här.
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { EmailSender } from "@/lib/server/integrations/email/email-sender";
import type { EmailDispatchLog } from "../email-dispatch-log";
import type { JobHandler } from "../job-worker-runtime";

/** Byrå och nyckel är valfria: jobb som redan ligger i kön (utan dem) parsas som förut. */
const emailJobSchema = z.object({
  to: z.string().min(1),
  subject: z.string(),
  text: z.string(),
  organizationId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
});

type EmailJob = z.infer<typeof emailJobSchema>;

/** Byrå + nyckel när jobbet bär båda och en logg finns; annars `null` (loggen tillfrågas inte). */
function logEntryOf(msg: EmailJob, log: EmailDispatchLog | undefined): { org: string; key: string } | null {
  if (!log || !msg.organizationId || !msg.idempotencyKey) return null;
  return { org: msg.organizationId, key: msg.idempotencyKey };
}

/** Bygg en handler som validerar payloaden och skickar via `sender`, högst en gång per nyckel med `log`. */
export function createEmailDispatchHandler(sender: EmailSender, log?: EmailDispatchLog): JobHandler {
  return async (job: Job): Promise<void> => {
    const msg = emailJobSchema.parse(job.data);
    const entry = logEntryOf(msg, log);
    if (entry && await log?.has(entry.org, entry.key)) return;
    await sender.sendMail({ to: msg.to, subject: msg.subject, text: msg.text });
    // Kraschar servern här, mellan utskick och loggning, skickas mejlet igen vid
    // omförsöket, som förut: ett tappat mejl är värre än ett dubbelt.
    if (entry) await log?.record(entry.org, entry.key);
  };
}
