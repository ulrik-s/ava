/**
 * Dubblettskydd för mejl som sparas från Outlook-tillägget: dokument-id:t
 * HÄRLEDS ur ärendet och mejlets Internet Message-ID. Samma mejl i samma ärende
 * får alltid samma id, så servern kan svara på "finns det redan?" och göra
 * sparningen idempotent (ett dubbelklick skapar varken två dokument eller två
 * tidsposter), utan en ny kolumn.
 *
 * Message-ID är detsamma oavsett mapp och Outlook-klient. Ett mejl får sparas
 * i flera ärenden — id:t skiljer sig per ärende.
 *
 * Web Crypto (crypto.subtle) i stället för node:crypto: routern körs också i
 * webbläsaren (demon).
 */

import { asId, type DocumentId } from "@/lib/shared/schemas/ids";

/**
 * UUID-format (version 8, "egen", RFC 9562) ur SHA-256 — dokument-kolumnen är
 * av typen uuid. Message-ID:t trimmas men behåller skiftläget (RFC 5322).
 */
export async function mailDocumentId(matterId: string, internetMessageId: string): Promise<DocumentId> {
  const data = new TextEncoder().encode(`ava-mail\u0000${matterId}\u0000${internetMessageId.trim()}`);
  const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16);
  return asId<"DocumentId">(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`);
}
