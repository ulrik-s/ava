/**
 * `graph-mail` — tunna MS Graph-mail-helpers för Outlook-add-in:en (#72, ADR 0013).
 *
 * Byrån är helt på M365 → båda Outlook-funktionerna går via MS Graph:
 *   - **Funktion 1 (inkommande):** hämta mailets råa `.eml`-MIME via
 *     `GET /me/messages/{id}/$value` (add-in:en skickar sedan bytes:en till
 *     AVA-servern via tRPC; servern äger git-db:n).
 *   - **Funktion 2 (utgående):** maila ut ett ärende-dokument via
 *     `POST /me/sendMail` (eller skapa ett utkast via `POST /me/messages`
 *     för granskning i Outlook).
 *
 * Rena builders + `fetch`-injicerade anrop → enhetstestbara utan Graph-runtime
 * (samma mönster som `createAddinClient`). Graph-token (Office-sidans data) är
 * ortogonal mot AVA:s Bearer-PAT (ADR 0013 §3).
 *
 * API-form verifierad mot Microsoft Learn (user: sendMail / outlook-get-mime-message).
 */

import { bytesToBase64 } from "@/lib/client/bytes-base64";

/** Graph v1.0-bas. */
export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

/** Minimal fetch-form (en DOM-`fetch` uppfyller den; injiceras i test). */
export type GraphFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Graph-fil-bilaga (base64-innehåll), som den ligger i `message.attachments`. */
export interface GraphFileAttachment {
  "@odata.type": "#microsoft.graph.fileAttachment";
  name: string;
  contentType: string;
  contentBytes: string;
}

/** Graph-meddelande (delmängd vi sätter). */
export interface GraphMessage {
  subject: string;
  body: { contentType: "Text" | "HTML"; content: string };
  toRecipients: { emailAddress: { address: string } }[];
  ccRecipients?: { emailAddress: { address: string } }[];
  attachments?: GraphFileAttachment[];
}

export interface ComposeMailInput {
  subject: string;
  /** Brödtext. `html: true` → contentType HTML, annars Text. */
  body: string;
  html?: boolean;
  to: string[];
  cc?: string[];
  attachments?: GraphFileAttachment[];
}

/** URL för att hämta ett meddelandes råa MIME (`.eml`). */
export function messageMimeUrl(restId: string): string {
  return `${GRAPH_BASE}/me/messages/${encodeURIComponent(restId)}/$value`;
}

/** Bygg en fil-bilaga ur råa bytes (base64-kodas för Graph). */
export function fileAttachment(name: string, contentType: string, bytes: Uint8Array): GraphFileAttachment {
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name,
    contentType,
    contentBytes: bytesToBase64(bytes),
  };
}

/** Bygg `message`-objektet (delas av sendMail + createDraft). */
export function buildMessage(input: ComposeMailInput): GraphMessage {
  const toRecipient = (address: string) => ({ emailAddress: { address } });
  return {
    subject: input.subject,
    body: { contentType: input.html ? "HTML" : "Text", content: input.body },
    toRecipients: input.to.map(toRecipient),
    ...(input.cc && input.cc.length > 0 ? { ccRecipients: input.cc.map(toRecipient) } : {}),
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
  };
}

async function graphError(res: Response, op: string): Promise<never> {
  const text = await res.text().catch(() => "");
  throw new Error(`Graph ${op} misslyckades: HTTP ${res.status} ${text}`.trim());
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

/** Hämta ett meddelandes `.eml` (rå MIME) som bytes + base64. */
export async function fetchMessageEml(
  opts: { token: string; restId: string; fetch?: GraphFetch },
): Promise<{ bytes: Uint8Array; base64: string }> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(messageMimeUrl(opts.restId), {
    headers: { authorization: `Bearer ${opts.token}` },
  });
  if (!res.ok) return graphError(res, "GET $value");
  const bytes = new Uint8Array(await res.arrayBuffer());
  return { bytes, base64: bytesToBase64(bytes) };
}

/** Skicka ett mail direkt (`POST /me/sendMail` → 202, sparas i Skickat). */
export async function sendMail(
  opts: { token: string; message: ComposeMailInput; saveToSentItems?: boolean; fetch?: GraphFetch },
): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  const body = JSON.stringify({
    message: buildMessage(opts.message),
    saveToSentItems: opts.saveToSentItems ?? true,
  });
  const res = await doFetch(`${GRAPH_BASE}/me/sendMail`, { method: "POST", headers: authHeaders(opts.token), body });
  if (!res.ok) return graphError(res, "sendMail");
}

/** Skapa ett utkast (`POST /me/messages` → 201) för granskning i Outlook.
 *  Returnerar utkastets id + webLink (om Graph gav dem). */
export async function createDraft(
  opts: { token: string; message: ComposeMailInput; fetch?: GraphFetch },
): Promise<{ id: string; webLink?: string }> {
  const doFetch = opts.fetch ?? fetch;
  const res = await doFetch(`${GRAPH_BASE}/me/messages`, {
    method: "POST",
    headers: authHeaders(opts.token),
    body: JSON.stringify(buildMessage(opts.message)),
  });
  if (!res.ok) return graphError(res, "createDraft");
  const json = (await res.json()) as { id: string; webLink?: string };
  return { id: json.id, ...(json.webLink ? { webLink: json.webLink } : {}) };
}
