"use client";

import { MatterNumber } from "@/components/matter/matter-number";
import { EntityLink } from "@/lib/client/demo/entity-link";

/** Det rubriken läser ur `invoice.getById`. */
interface InvoiceHeaderData {
  invoiceType: string;
  invoiceDate: string | Date;
  invoiceNumber?: string | null | undefined;
  ocrReference?: string | null | undefined;
  matter: { id: string; matterNumber: string; title: string; responsibleLawyerId?: string | null | undefined };
}

const HEADINGS: Record<string, string> = { ACCONTO: "Aconto-faktura", FINAL: "Slutfaktura", CREDIT: "Kreditfaktura" };

/** Fakturans huvud: länken tillbaka till ärendet (med juristens initialer, #1728), typ, nummer, datum och OCR. */
export function InvoiceHeader({ inv }: { inv: InvoiceHeaderData }) {
  const heading = HEADINGS[inv.invoiceType] ?? "Faktura";
  const { invoiceNumber, ocrReference } = inv;
  return (
    <div>
      <EntityLink route="matters" id={inv.matter.id} className="text-sm text-blue-600 hover:underline">← <MatterNumber matterNumber={inv.matter.matterNumber} responsibleLawyerId={inv.matter.responsibleLawyerId} /> {inv.matter.title}</EntityLink>
      <h1 className="text-2xl font-bold mt-2">
        {heading}
        {invoiceNumber && <span className="ml-3 text-base font-normal text-gray-700">{invoiceNumber}</span>}
        <span className="ml-3 text-sm font-normal text-gray-500">{new Date(inv.invoiceDate).toLocaleDateString("sv-SE")}</span>
      </h1>
      {ocrReference && <p className="text-sm text-gray-500 mt-1">OCR: <span className="font-mono">{ocrReference}</span></p>}
    </div>
  );
}
