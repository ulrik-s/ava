"use client";

/**
 * Dialogen **Maila dokument** (#1951), öppnad från dokumentmenyns **Maila…**.
 * Till är ärendets klienter med e-post (går att ändra), Ämne dokumentets titel,
 * Meddelande tomt och Bilaga dokumentet. Inget skickas utan klick på
 * **Skicka**. Logiken ligger i `useMailDocument`, reglerna i `_mail-document-rules`.
 */

import { useId } from "react";
import { Modal } from "@/components/ui/modal";
import { formatFileSize } from "./_drag-helpers";
import { MAIL_TOO_LARGE_TEXT } from "./_mail-document-rules";
import { useMailDocument, type MailableDocument, type MailDeps, type MailPhase } from "./use-mail-document";

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const LABEL = "block text-sm font-medium text-gray-700 mb-1";

function Field({ label, hint, children }: { label: string; hint?: string | false; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-amber-700">{hint}</p>}
    </div>
  );
}

/** "Skickat." eller felet, under fälten. */
function PhaseLine({ phase }: { phase: MailPhase }) {
  if (phase.kind === "sent") return <p role="status" className="text-sm text-green-700">Skickat.</p>;
  if (phase.kind === "error") return <p role="alert" className="text-sm text-red-700">{phase.message}</p>;
  return null;
}

function MailForm({ doc, onClose, deps }: { doc: MailableDocument; onClose: () => void; deps?: MailDeps | undefined }) {
  const m = useMailDocument(doc, onClose, deps);
  return (
    <div className="space-y-3">
      <Field label="Till" hint={m.noClientEmail && "Klienten saknar e-post i AVA"}>
        {(id) => <input id={id} className={INPUT} value={m.to} onChange={(e) => m.setTo(e.target.value)} />}
      </Field>
      <Field label="Ämne">{(id) => <input id={id} className={INPUT} value={m.subject} onChange={(e) => m.setSubject(e.target.value)} />}</Field>
      <Field label="Meddelande">
        {(id) => <textarea id={id} rows={5} className={INPUT} value={m.body} onChange={(e) => m.setBody(e.target.value)} />}
      </Field>
      <div>
        <p className={LABEL}>Bilaga</p>
        <p className="text-sm text-gray-700">📎 {doc.fileName} ({formatFileSize(doc.sizeBytes)})</p>
        {!m.fits && <p role="alert" className="mt-1 text-sm text-red-700">{MAIL_TOO_LARGE_TEXT}</p>}
      </div>
      <PhaseLine phase={m.phase} />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-4 py-2 text-sm">Avbryt</button>
        <button type="button" onClick={() => void m.send()} disabled={!m.canSend}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {m.phase.kind === "sending" ? "Skickar…" : "Skicka"}
        </button>
      </div>
    </div>
  );
}

/** Dialogen. Renderas bara när den är öppen, så att ärendet läses först då. */
export function MailDocumentDialog({ doc, onClose, deps }: { doc: MailableDocument; onClose: () => void; deps?: MailDeps }) {
  return (
    <Modal open title="Maila dokument" onClose={onClose}>
      <MailForm doc={doc} onClose={onClose} deps={deps} />
    </Modal>
  );
}
