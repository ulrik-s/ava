"use client";

/**
 * Manuellt fakturautskick (#179) — utan servermjukvara. Advokaten skickar
 * fakturan som PDF via sin EGEN mailklient (helper `compose-mail`) eller laddar
 * ner PDF:en och bifogar själv. AVA registrerar utskicket i git-db:n (#178)
 * först när advokaten BEKRÄFTAR att hen skickat — undviker falska positiv
 * (att öppna mailklienten ≠ skickat). Ingen backend kan verifiera leverans här.
 */

import { Mail, Download, X } from "lucide-react";
import { useState } from "react";

import { bytesToBase64 } from "@/lib/client/bytes-base64";
import { downloadBytes } from "@/lib/client/download-text";
import { useHelper, composeMailViaHelper } from "@/lib/client/helper/use-helper";
import { renderFakturaPdf } from "@/lib/client/kostnadsrakning/render-faktura-pdf";
import { trpc } from "@/lib/client/trpc";
import { formatCurrency } from "@/lib/client/utils";

export interface SendInvoiceModalProps {
  invoiceId: string;
  invoiceNumber?: string | null | undefined;
  amount: number;
  ocrReference?: string | null | undefined;
  invoiceDate?: string | Date | null | undefined;
  matterNumber: string;
  matterTitle: string;
  onClose: () => void;
  onRecorded: () => void;
}

function mailBody(p: SendInvoiceModalProps): string {
  const lines = [
    `Faktura ${p.invoiceNumber ?? ""}`.trim(),
    `Belopp: ${formatCurrency(p.amount)}`,
  ];
  if (p.ocrReference) lines.push(`OCR-referens: ${p.ocrReference}`);
  lines.push("", "Fakturan bifogas som PDF.");
  return lines.join("\n");
}

function pdfFileName(p: SendInvoiceModalProps): string {
  return `Faktura ${p.invoiceNumber ?? p.matterNumber}.pdf`;
}

async function buildPdf(p: SendInvoiceModalProps, recipient: string): Promise<Uint8Array> {
  return renderFakturaPdf({
    invoice: {
      amount: p.amount,
      invoiceNumber: p.invoiceNumber ?? null,
      ocrReference: p.ocrReference ?? null,
      invoiceDate: p.invoiceDate ?? null,
    },
    meta: { matterNumber: p.matterNumber, matterTitle: p.matterTitle, ...(recipient ? { recipient } : {}) },
  });
}

interface SendInvoiceState {
  recipient: string;
  setRecipient: (v: string) => void;
  prepared: boolean;
  busy: boolean;
  note: string | null;
  error: string | null;
  isPending: boolean;
  queuePending: boolean;
  onEmail: () => void;
  onDownload: () => void;
  onQueue: () => void;
  confirmSent: () => void;
}

/** Logiken bakom utskicket (PDF → helper/nedladdning → bekräfta → dispatch). */
function useSendInvoice(props: SendInvoiceModalProps): SendInvoiceState {
  const [recipient, setRecipient] = useState("");
  const [prepared, setPrepared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const helper = useHelper();

  const record = trpc.invoiceDispatch.recordManual.useMutation({
    onSuccess: () => { props.onRecorded(); props.onClose(); },
    onError: (e) => setError(e.message),
  });
  // Automatiskt utskick (#392): köa → server-runtime-workern skickar via SMTP.
  const queue = trpc.invoiceDispatch.queue.useMutation({
    onSuccess: () => { props.onRecorded(); props.onClose(); },
    onError: (e) => setError(e.message),
  });

  const onQueue = (): void => {
    const trimmed = recipient.trim();
    if (!trimmed.includes("@")) { setError("Ange mottagarens e-post för automatiskt utskick."); return; }
    setError(null);
    queue.mutate({ invoiceId: props.invoiceId, channel: "email", recipient: trimmed });
  };

  const run = async (fn: () => Promise<string>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      setNote(await fn());
      setPrepared(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onEmail = () => void run(async () => {
    const bytes = await buildPdf(props, recipient);
    const opened = Boolean(helper.version) && await composeMailViaHelper({
      ...(recipient ? { to: recipient } : {}),
      fileName: pdfFileName(props),
      contentBase64: bytesToBase64(bytes),
      mimeType: "application/pdf",
      subject: `Faktura ${props.invoiceNumber ?? props.matterNumber}`,
      body: mailBody(props),
    });
    if (opened) return "Mailklienten öppnades med fakturan bifogad. Tryck skicka där.";
    downloadBytes(pdfFileName(props), new Uint8Array(bytes), "application/pdf");
    return "Ingen helper hittades — PDF:en laddades ner. Bifoga den själv i din mailklient.";
  });

  const onDownload = () => void run(async () => {
    const bytes = await buildPdf(props, recipient);
    downloadBytes(pdfFileName(props), new Uint8Array(bytes), "application/pdf");
    return "PDF:en laddades ner.";
  });

  const confirmSent = () => {
    const trimmed = recipient.trim();
    record.mutate({
      invoiceId: props.invoiceId,
      channel: trimmed.includes("@") ? "email" : "manual",
      recipient: trimmed || "Manuellt utskick",
    });
  };

  return {
    recipient, setRecipient, prepared, busy, note, error,
    isPending: record.isPending, queuePending: queue.isPending,
    onEmail, onDownload, onQueue, confirmSent,
  };
}

export function SendInvoiceModal(props: SendInvoiceModalProps) {
  const s = useSendInvoice(props);
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex md:items-center md:justify-center md:p-4">
      <div className="bg-white w-full md:max-w-lg md:rounded-xl flex flex-col h-full md:h-auto overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
          <h2 className="text-base sm:text-lg font-bold text-gray-900 flex items-center gap-2">
            <Mail size={18} className="text-blue-600" />
            Skicka faktura {props.invoiceNumber ?? ""}
          </h2>
          <button onClick={props.onClose} aria-label="Stäng" className="p-2 hover:bg-gray-100 rounded">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block text-sm">
            <span className="text-gray-700">Mottagarens e-post (valfritt)</span>
            <input
              type="email"
              value={s.recipient}
              onChange={(e) => s.setRecipient(e.target.value)}
              placeholder="klient@example.se"
              className="mt-1 w-full rounded border border-gray-300 px-3 py-1.5 text-sm"
            />
            <span className="mt-1 block text-xs text-gray-400">
              Används för både automatiskt och manuellt utskick.
            </span>
          </label>

          <AutoSendSection s={s} />
          <ManualSendSection s={s} />

          {s.note && <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded p-2">{s.note}</p>}
          {s.error && <p className="text-sm text-red-600">{s.error}</p>}

          <ConfirmSentBlock s={s} />
        </div>
      </div>
    </div>
  );
}

/** Automatiskt utskick: köa → server-runtime skickar via SMTP (#392). */
function AutoSendSection({ s }: { s: SendInvoiceState }) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
      <p className="text-sm font-medium text-blue-900 mb-1">Automatiskt utskick</p>
      <p className="text-xs text-blue-800 mb-2">
        Köa fakturan — servern skickar den via e-post (kräver konfigurerad SMTP).
      </p>
      <button
        onClick={s.onQueue}
        disabled={s.busy || s.queuePending || s.isPending}
        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
      >
        <Mail size={15} /> {s.queuePending ? "Köar…" : "Köa för automatiskt utskick"}
      </button>
    </div>
  );
}

/** Manuellt utskick: advokaten skickar via egen mailklient (helper) / nedladdning. */
function ManualSendSection({ s }: { s: SendInvoiceState }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-sm font-medium text-gray-900 mb-1">Manuellt utskick</p>
      <p className="text-xs text-gray-500 mb-2">
        Skicka från din egen e-post via helper-appen, eller ladda ner PDF:en och bifoga själv.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={s.onEmail}
          disabled={s.busy || s.isPending}
          className="px-3 py-1.5 text-sm bg-gray-800 text-white rounded hover:bg-gray-900 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Mail size={15} /> Öppna i mailklient
        </button>
        <button
          onClick={s.onDownload}
          disabled={s.busy || s.isPending}
          className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Download size={15} /> Ladda ner PDF
        </button>
      </div>
    </div>
  );
}

/** "Markera som skickad" efter att man förberett ett manuellt utskick. */
function ConfirmSentBlock({ s }: { s: SendInvoiceState }) {
  if (!s.prepared) return null;
  return (
    <div className="border-t pt-3">
      <p className="text-sm text-gray-700 mb-2">
        Har du skickat fakturan? Markera den som skickad så registreras utskicket i AVA.
      </p>
      <button
        onClick={s.confirmSent}
        disabled={s.isPending}
        className="px-3 py-1.5 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
      >
        {s.isPending ? "Registrerar…" : "Markera som skickad"}
      </button>
    </div>
  );
}
