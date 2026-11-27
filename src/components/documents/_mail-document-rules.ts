/**
 * Maila dokument (#1951): reglerna bakom dialogen, utan React och utan nätet.
 * Mottagaren är ärendets klient, storleken spärras före hämtningen, och Till
 * kräver minst en giltig adress.
 */

import { z } from "zod";

/**
 * Största bilaga som skickas i samma `sendMail`-anrop: 3 MB. Microsoft Graph
 * tar bilagor under 3 MB i meddelandets JSON (fileAttachment); större filer
 * kräver en uppladdningssession, som AVA inte gör. Bilagan skickas base64-kodad,
 * alltså ungefär en tredjedel större än filen.
 */
export const MAIL_ATTACHMENT_MAX_BYTES = 3 * 1024 * 1024;

/** Texten när filen är för stor för att mailas från AVA. */
export const MAIL_TOO_LARGE_TEXT =
  "Filen är för stor för att skickas från AVA (högst 3 MB). Ladda ner den och bifoga den i Outlook i stället.";

/** En part i ärendet, strukturellt som `matter.getById` ger den. */
export interface MailParty {
  role: string;
  contact?: { email?: string | null } | null;
}

/** E-postadresserna till ärendets parter med rollen KLIENT som har e-post, i ärendets ordning. */
export function clientRecipients(parties: readonly MailParty[] | null | undefined): string[] {
  return (parties ?? []).flatMap((p) => {
    const email = p.role === "KLIENT" ? p.contact?.email?.trim() : undefined;
    return email ? [email] : [];
  });
}

/** Adresserna i fältet Till: kommatecken eller semikolon mellan, tomma bort. */
export function parseRecipients(text: string): string[] {
  return text.split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 0);
}

const emailSchema = z.email();

/** Minst en adress, och alla giltiga. */
export function hasValidRecipients(addresses: readonly string[]): boolean {
  return addresses.length > 0 && addresses.every((a) => emailSchema.safeParse(a).success);
}

/** Sant när filen ryms i en bilaga (gränsen inräknad). */
export function fitsMailAttachment(sizeBytes: number): boolean {
  return sizeBytes <= MAIL_ATTACHMENT_MAX_BYTES;
}

/** Ämnet: dokumentets titel, annars filnamnet. */
export function mailSubject(doc: { title?: string | null | undefined; fileName: string }): string {
  return doc.title?.trim() || doc.fileName;
}
