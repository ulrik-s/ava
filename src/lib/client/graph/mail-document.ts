/**
 * `mailDocument` — Outlook-funktion 2 (#72, ADR 0013): maila ut ett
 * ärende-dokument från AVA via MS Graph. Triggas i web-appen (dokumentlistan),
 * inte i Outlook → web-app-funktion, ingen add-in.
 *
 * Ren orkestrering ovanpå `graph-mail`: bygg en fil-bilaga av dokumentets
 * bytes och skicka direkt (`sendMail`) eller skapa ett utkast (`createDraft`)
 * för granskning i Outlook. `fetch`-injicerad → testbar utan Graph-runtime.
 *
 * Graph-token hämtas av anroparen (web: Office365-connectorn / MSAL — separat
 * auth-infra). Token är ortogonal mot AVA:s Bearer-PAT (ADR 0013 §3).
 */

import { sendMail, createDraft, fileAttachment, type ComposeMailInput, type GraphFetch } from "./graph-mail";

export interface MailDocumentInput {
  token: string;
  /** Dokumentet som ska bifogas (bytes lästa ur git-working-copy:n/FSA). */
  doc: { fileName: string; mimeType: string; bytes: Uint8Array };
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  html?: boolean;
  /** true → skapa utkast i Outlook för granskning i st.f. att skicka direkt. */
  asDraft?: boolean;
  fetch?: GraphFetch;
}

export type MailDocumentResult = { sent: true } | { draftId: string; webLink?: string };

/** Bifoga dokumentet och skicka (eller skapa utkast). */
export async function mailDocument(input: MailDocumentInput): Promise<MailDocumentResult> {
  const attachment = fileAttachment(input.doc.fileName, input.doc.mimeType, input.doc.bytes);
  const message: ComposeMailInput = {
    subject: input.subject,
    body: input.body,
    ...(input.html ? { html: true } : {}),
    to: input.to,
    ...(input.cc ? { cc: input.cc } : {}),
    attachments: [attachment],
  };
  const fetchOpt = input.fetch ? { fetch: input.fetch } : {};
  if (input.asDraft) {
    const draft = await createDraft({ token: input.token, message, ...fetchOpt });
    return { draftId: draft.id, ...(draft.webLink ? { webLink: draft.webLink } : {}) };
  }
  await sendMail({ token: input.token, message, ...fetchOpt });
  return { sent: true };
}
