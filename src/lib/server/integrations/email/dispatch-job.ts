/**
 * Fakturautskicks-worker (#180, ADR 0005 fas 2) — server-runtime-peer som
 * skickar KÖADE e-postutskick (#178) och skriver tillbaka status:en.
 *
 * Flöde per tick: lista köade dispatch-poster (kanal=email) → bygg mejl ur
 * fakturan → skicka via SMTP ([[smtp-sender]]) → `updateStatus` sent (messageId)
 * eller failed (error). IDEMPOTENT: bara `queued` plockas; så fort en post är
 * `sent` hoppar nästa cykel över den → ofarligt vid omkörning. Inget köat →
 * ingen mutation → no-empty-commit-grinden (#80) pushar inget.
 *
 * Bara e-post-kanalen här; e-faktura/Kivra/print spåras som egna issuer.
 */

import type { PeerJob } from "../../local-first/peer-loop";
import type { EmailSender, EmailMessage } from "./email-sender";

/** En köad dispatch-post med joinad faktura (ur invoiceDispatch.listQueued). */
export interface QueuedDispatch {
  id: string;
  channel: string;
  recipient: string;
  invoice?: {
    invoiceNumber?: string | null;
    amount?: number | null;
    ocrReference?: string | null;
    dueDate?: Date | string | null;
  } | null;
}

export interface DispatchJobCaller {
  invoiceDispatch: {
    listQueued: (input: Record<string, never>) => Promise<QueuedDispatch[]>;
    updateStatus: (input: {
      dispatchId: string;
      status: "sent" | "failed";
      messageId?: string;
      error?: string;
    }) => Promise<unknown>;
  };
}

export interface DispatchJobDeps {
  /** Bygg e-post-sändaren för cykeln (vault-creds). null = ej konfigurerad. */
  loadSender: () => EmailSender | null;
  /** Avsändar-/byrånamn i mejltexten. */
  senderName?: string;
  log?: (msg: string) => void;
}

export interface DispatchResult {
  sent: number;
  failed: number;
}

/** "faktura F-1 på 125 kr" / "en faktura" — fakturaraden i mejltexten. */
function invoiceLine(d: QueuedDispatch): string {
  const nr = d.invoice?.invoiceNumber;
  const amount = d.invoice?.amount;
  const krona = amount != null ? ` på ${(amount / 100).toLocaleString("sv-SE")} kr` : "";
  return `${nr ? `faktura ${nr}` : "en faktura"}${krona}`;
}

/** OCR- + förfallodatum-rader (om de finns). */
function metaLines(d: QueuedDispatch): string {
  const ocr = d.invoice?.ocrReference ? `\nOCR: ${d.invoice.ocrReference}` : "";
  const due = d.invoice?.dueDate ? `\nFörfallodatum: ${new Date(d.invoice.dueDate).toLocaleDateString("sv-SE")}` : "";
  return ocr + due;
}

/** Bygg ett (enkelt) fakturamejl ur dispatch-posten. Ren funktion. */
export function buildInvoiceEmail(d: QueuedDispatch, senderName: string): EmailMessage {
  const nr = d.invoice?.invoiceNumber;
  return {
    to: d.recipient,
    subject: nr ? `Faktura ${nr} från ${senderName}` : `Faktura från ${senderName}`,
    text: `Hej,\n\nHär kommer ${invoiceLine(d)}.${metaLines(d)}\n\nMed vänlig hälsning,\n${senderName}`,
  };
}

/** Skicka ETT utskick och skriv tillbaka status (sent/failed). */
async function sendOne(
  caller: DispatchJobCaller,
  sender: EmailSender,
  d: QueuedDispatch,
  senderName: string,
): Promise<boolean> {
  try {
    const { messageId } = await sender.sendMail(buildInvoiceEmail(d, senderName));
    await caller.invoiceDispatch.updateStatus({ dispatchId: d.id, status: "sent", messageId });
    return true;
  } catch (err) {
    await caller.invoiceDispatch.updateStatus({ dispatchId: d.id, status: "failed", error: String(err) });
    return false;
  }
}

/** Skicka alla köade e-postutskick. Idempotent (bara queued plockas). */
export async function dispatchQueuedEmails(
  caller: DispatchJobCaller,
  deps: DispatchJobDeps,
): Promise<DispatchResult> {
  const log = deps.log ?? (() => {});
  const sender = deps.loadSender();
  if (!sender) {
    log("Utskick: ingen e-post-sändare konfigurerad — hoppar över");
    return { sent: 0, failed: 0 };
  }
  const senderName = deps.senderName ?? "AVA";
  const queued = (await caller.invoiceDispatch.listQueued({})).filter((d) => d.channel === "email");

  let sent = 0;
  let failed = 0;
  for (const d of queued) {
    if (await sendOne(caller, sender, d, senderName)) sent += 1;
    else failed += 1;
  }
  if (sent || failed) log(`Utskick: ${sent} skickade, ${failed} misslyckade`);
  return { sent, failed };
}

/** Paketera som ett `PeerJob` för server-runtime:ns peer-loop. */
export function makeDispatchJob(deps: DispatchJobDeps): PeerJob {
  return {
    message: "chore(dispatch): skicka köade fakturautskick (e-post)",
    act: async (caller) => {
      await dispatchQueuedEmails(caller as unknown as DispatchJobCaller, deps);
    },
  };
}
