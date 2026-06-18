/**
 * E-postutskicks-handler (#504 Fas 3) — konsumerar `email-dispatch`-kön och
 * skickar mejlet via en injicerad `EmailSender` (smtp-sender i produktion).
 *
 * pg-boss äger durabiliteten: kastar handlern (SMTP-fel) retry:ar pg-boss med
 * backoff och dead-letter:ar efter `retryLimit`. Idempotens: skicka samma jobb
 * en gång — pg-boss levererar varje jobb till EN worker via lease/SKIP LOCKED.
 *
 * Payloaden är ett färdigbyggt mejl (`{to,subject,text}`); att BYGGA mejlet ur
 * en faktura hör hemma hos enqueue:aren (routern) — handlern är generisk send.
 * Zod vid parsegränsen (#187): job.data är otypad tills den parsas här.
 */

import type { Job } from "pg-boss";
import { z } from "zod";
import type { EmailSender } from "@/lib/server/integrations/email/email-sender";
import type { JobHandler } from "../job-worker-runtime";

const emailJobSchema = z.object({
  to: z.string().min(1),
  subject: z.string(),
  text: z.string(),
});

/** Bygg en handler som validerar payloaden och skickar via `sender`. */
export function createEmailDispatchHandler(sender: EmailSender): JobHandler {
  return async (job: Job): Promise<void> => {
    const msg = emailJobSchema.parse(job.data);
    await sender.sendMail(msg);
  };
}
