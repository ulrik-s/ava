/**
 * `DisabledEmailSender` — e-postporten när utskick är avstängt (`AVA_EMAIL_DISABLED=1`),
 * t.ex. på en test- eller pilotserver med riktiga användare men utan riktiga klienter.
 *
 * VÄGRAR i st.f. att tyst slänga: ett flöde som tror att mejlet gick iväg kunde
 * annars markera t.ex. en faktura som skickad till klienten. Och den KÖAR inget —
 * `QueueBackedEmailSender` hade lagt mejlen i pg-boss där de väntat, och gått iväg
 * allihop den dag någon konfigurerade SMTP.
 */

import type { IEmailSender, SendEmailInput } from "@/lib/server/ports";

export const EMAIL_DISABLED_MESSAGE = "E-postutskick är avstängt på denna server (AVA_EMAIL_DISABLED).";

export class DisabledEmailSender implements IEmailSender {
  send(_input: SendEmailInput): Promise<void> {
    return Promise.reject(new Error(EMAIL_DISABLED_MESSAGE));
  }
}

/** Är utskick avstängt? Allt utom exakt "1"/"true" räknas som PÅ (dagens beteende). */
export function isEmailDisabled(env: Record<string, string | undefined> = process.env): boolean {
  const v = env.AVA_EMAIL_DISABLED;
  return v === "1" || v === "true";
}

/** Startloggens rad om e-post — så driften ser direkt att utskick är avstängt. */
export function emailStatusLine(env: Record<string, string | undefined> = process.env): string {
  return isEmailDisabled(env)
    ? "e-postutskick AVSTÄNGT (AVA_EMAIL_DISABLED) — inga mejl köas eller skickas"
    : "e-postutskick på (skickas när AVA_SMTP_* är satt)";
}
