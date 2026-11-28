"use client";

/**
 * Fakturans dokument (PDF m.fl.) på fakturasidan: listan med typerna
 * (ADR 0038) och öppning i ny flik. Utbruten ur `_client.tsx` (filstorleken).
 */

import { SECTION_FILL_CLASS } from "@/components/ui/section-tone";
import type { DownloadClient } from "@/lib/client/backend/load-document-blob";
import { DEMO_REPO, isDemoTier } from "@/lib/client/firma/firma-config";
import { trpc } from "@/lib/client/trpc";
import { kindLabel } from "@/lib/shared/document-kind";
import { documentKinds, type KindsCarrier } from "@/lib/shared/document-kinds";
import type { DocumentId } from "@/lib/shared/schemas/ids";

/** Det listan behöver av ett fakturadokument. */
export interface InvoiceDocRow extends KindsCarrier {
  id: DocumentId;
  fileName: string;
  storagePath?: string | null | undefined;
}

/**
 * Öppna ett fakturadokument (PDF m.fl.) i en ny flik — SAMMA flöde som
 * dokumentraden på ärende-sidan ([[_document-row]]): runtime-genererade docs
 * öppnas ur blob-cachen, seed-docs hämtas från GH Pages, self-hosted ur FSA.
 * Tidigare länkade namnet felaktigt till /matters → man dirigerades in i
 * ärendet istället för att få upp filen.
 */
async function openInvoiceDoc(doc: InvoiceDocRow, client: DownloadClient): Promise<void> {
  const { openDocument } = await import("@/lib/client/firma/open-document");
  const { loadHandle } = await import("@/lib/client/fsa/handle-store");
  const { readFromFsa } = await import("@/lib/client/fsa/read-from-fsa");
  const { loadDocumentBlob } = await import("@/lib/client/backend/load-document-blob");
  await openDocument({
    doc: { id: doc.id, ...(doc.storagePath != null ? { storagePath: doc.storagePath } : {}), fileName: doc.fileName },
    // RUNTIME-tier, inte NEXT_PUBLIC_DEMO_BUILD (sant även i lokala self-hosted-
    // builden → länkade fakturadokument till GH Pages = 404). #844.
    isDemo: isDemoTier(),
    demoRepo: DEMO_REPO,
    loadHandle: () => loadHandle("repo-root"),
    readFromHandle: readFromFsa,
    // Server-first (#518): hämta bytes från servern (+ klient-cache) i st.f. FSA.
    fetchBlob: () => loadDocumentBlob(client, { id: doc.id, storagePath: doc.storagePath ?? null, fileName: doc.fileName }),
    openUrl: (u) => window.open(u, "_blank", "noopener,noreferrer"),
    notifyError: (m) => alert(m),
  });
}

export function InvoiceDocumentsCard({ documents }: { documents: InvoiceDocRow[] }) {
  const utils = trpc.useUtils();
  if (documents.length === 0) return null;
  return (
    <div className={`${SECTION_FILL_CLASS} p-2`}>
      <h2 className="font-semibold mb-2">Fakturadokument</h2>
      <ul className="text-sm divide-y divide-gray-100">
        {documents.map((d) => (
          <li key={d.id} className="py-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => void openInvoiceDoc(d, utils.client)}
              className="text-blue-600 hover:underline text-left"
            >
              {d.fileName}
            </button>
            <InvoiceDocKinds doc={d} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dokumentets typer (ADR 0038) som en liten etikett; inget om typ saknas. */
function InvoiceDocKinds({ doc }: { doc: KindsCarrier }) {
  const kinds = documentKinds(doc);
  if (kinds.length === 0) return null;
  return <span className="text-[10px] rounded-full bg-gray-100 text-gray-600 px-2 py-0.5">{kinds.map(kindLabel).join(" + ")}</span>;
}
