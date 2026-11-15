"use client";

/**
 * "Redigera uppgifter…" i dokumentets ⋯-meny: titel, filnamn, klassning
 * (dokumenttyp), riktning, mottagare och sammanfattning. En Spara gör ett
 * `document.updateDetails` med det som ändrats. En ändrad klassning skrivs
 * inte över av en ny AI-analys (se routern).
 */

import { useId, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { trpc } from "@/lib/client/trpc";
import { cleanFileName } from "@/lib/shared/document-file-name";
import { KIND_LABELS, KNOWN_KINDS } from "@/lib/shared/document-kind";
import type { DocumentId } from "@/lib/shared/schemas/ids";
import {
  canSaveDetails, detailsChanges, detailsFromDocument, DOCUMENT_RECIPIENT_LABELS, type DocumentDetailsValues, type EditableDocument,
} from "./_document-details-input";

const INPUT = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm";
const LABEL = "block text-sm font-medium text-gray-700 mb-1";

function Field({ label, hint, children }: { label: string; hint?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={LABEL}>{label}</label>
      {children(id)}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

/** Hjälptexten under filnamnet: det städade namnet när det skiljer sig. */
function fileNameHint(input: string, original: string): string {
  const preview = cleanFileName(input, original);
  return preview && preview !== input ? `Sparas som: ${preview}` : "Filändelsen behålls. Själva filen påverkas inte.";
}

/** Förstavalet i dokumenttypen när ingen känd typ är vald (t.ex. "E-post (oförändrad)"). */
function unchangedTypeLabel(documentType: string | null | undefined): string {
  return documentType ? `${documentType} (oförändrad)` : "Ej klassificerad";
}

function DetailsForm({ docId, doc, onClose }: { docId: DocumentId; doc: EditableDocument; onClose: () => void }) {
  const [v, setV] = useState<DocumentDetailsValues>(() => detailsFromDocument(doc));
  const set = <K extends keyof DocumentDetailsValues>(k: K) => (value: DocumentDetailsValues[K]) => setV({ ...v, [k]: value });
  const utils = trpc.useUtils();
  const update = trpc.document.updateDetails.useMutation({
    onSuccess: () => { void utils.document.invalidate(); onClose(); },
  });
  const changes = detailsChanges(doc, v);
  const canSave = Object.keys(changes).length > 0 && canSaveDetails(doc, v);
  return (
    <div className="space-y-3">
      <Field label="Titel">{(id) => <input id={id} className={INPUT} value={v.title} onChange={(e) => set("title")(e.target.value)} />}</Field>
      <Field label="Filnamn" hint={fileNameHint(v.fileName, doc.fileName)}>
        {(id) => <input id={id} className={INPUT} value={v.fileName} onChange={(e) => set("fileName")(e.target.value)} />}
      </Field>
      <Field label="Dokumenttyp" hint="Rättar AI:ns klassning. En ny AI-analys skriver inte över ditt val.">
        {(id) => (
          <select id={id} className={INPUT} value={v.documentType} onChange={(e) => set("documentType")(e.target.value as DocumentDetailsValues["documentType"])}>
            {v.documentType === "" && <option value="">{unchangedTypeLabel(doc.documentType)}</option>}
            {KNOWN_KINDS.map((k) => <option key={k} value={k}>{KIND_LABELS[k]}</option>)}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Riktning">
          {(id) => (
            <select id={id} className={INPUT} value={v.direction} onChange={(e) => set("direction")(e.target.value as DocumentDetailsValues["direction"])}>
              <option value="">–</option>
              <option value="INKOMMANDE">Inkommande</option>
              <option value="UTGAENDE">Utgående</option>
            </select>
          )}
        </Field>
        <Field label="Mottagare / avsändare">
          {(id) => (
            <select id={id} className={INPUT} value={v.recipient} onChange={(e) => set("recipient")(e.target.value as DocumentDetailsValues["recipient"])}>
              <option value="">–</option>
              {Object.entries(DOCUMENT_RECIPIENT_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          )}
        </Field>
      </div>
      <Field label="Sammanfattning">
        {(id) => <textarea id={id} rows={3} className={INPUT} value={v.summary} onChange={(e) => set("summary")(e.target.value)} />}
      </Field>
      {update.error && <p className="text-sm text-red-700">{update.error.message}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm border border-gray-300 rounded">Avbryt</button>
        <button type="button" disabled={update.isPending || !canSave}
          onClick={() => update.mutate({ documentId: docId, ...changes })}
          className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
          {update.isPending ? "Sparar…" : "Spara"}
        </button>
      </div>
    </div>
  );
}

/** Dialogen. Formuläret monteras först när den öppnas → startar alltid från dokumentets sparade uppgifter. */
export function DocumentDetailsDialog({ docId, doc, open, onClose }: {
  docId: DocumentId; doc: EditableDocument; open: boolean; onClose: () => void;
}) {
  return (
    <Modal open={open} title="Redigera uppgifter" onClose={onClose} widthClass="max-w-xl">
      {open && <DetailsForm docId={docId} doc={doc} onClose={onClose} />}
    </Modal>
  );
}
