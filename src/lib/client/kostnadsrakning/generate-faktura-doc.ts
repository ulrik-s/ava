"use client";

/**
 * `generateFakturaDoc` (#397) — generera ett faktura-DOKUMENT (PDF) ur en nyss
 * skapad Invoice-entitet och lägg det i ärendets fil-lista, parallellt med
 * Invoice-objektet. `document.register` emittar inga events (ingen read-only-
 * trap), så detta funkar i både demo- och git-backend.
 *
 * Bröts ut ur `_verdict-dialog.tsx` så aconto-/slutfaktura-flödet i
 * `_billing-dialog.tsx` kan dela exakt samma kod (DRY).
 */

import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/lib/server/routers/_app";
import { omitUndefined } from "@/lib/shared/omit-undefined";
import { asId, type InvoiceId, type MatterId } from "@/lib/shared/schemas/ids";

type RouterInputs = inferRouterInputs<AppRouter>;
type RegisterInput = RouterInputs["document"]["register"];
type TreeFilter = RouterInputs["document"]["tree"];
type ListFilter = RouterInputs["document"]["list"];

export type RegisterMut = { mutateAsync: (i: RegisterInput) => Promise<unknown> };
export type DocUtils = {
  document: {
    tree: { invalidate: (f?: TreeFilter) => Promise<unknown>; refetch: (f?: TreeFilter) => Promise<unknown> };
    list: { invalidate: (f?: ListFilter) => Promise<unknown> };
  };
};

export interface FakturaDocMeta {
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  recipient?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
}

export interface FakturaDocInvoice {
  id: InvoiceId;
  amount: number;
  /** Momsbelopp (öre) i `amount`, exakt per sats (#782). Saknas → 25 %-split. */
  vatOre?: number | null | undefined;
  invoiceNumber?: string | null | undefined;
  ocrReference?: string | null | undefined;
  invoiceDate?: string | Date | null | undefined;
}

export interface GenerateFakturaDocArgs {
  invoice: FakturaDocInvoice;
  matterId: MatterId;
  meta: FakturaDocMeta;
  register: RegisterMut;
  utils: DocUtils;
}

/** Inbyggd faktura-mall (Handlebars) — används av template-motorn (#852) när
 *  ingen byrå-mall finns. HTML → öppningsbar + skrivbar. */
const FAKTURA_TEMPLATE = `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>Faktura {{invoiceNumber}}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111">
<h1 style="margin-bottom:0">Faktura</h1>
<p style="color:#555">Fakturanr: {{invoiceNumber}}{{#if ocr}} · OCR: {{ocr}}{{/if}}<br>Datum: {{date}}</p>
<p style="color:#555">Ärende {{matterNumber}} — {{matterTitle}}<br>Mottagare: {{recipient}}</p>
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin-top:1rem">
<tbody>
<tr><td>Netto (exkl moms)</td><td style="text-align:right">{{net}}</td></tr>
<tr><td>Moms</td><td style="text-align:right">{{vat}}</td></tr>
</tbody>
<tfoot><tr style="border-top:2px solid #333"><td style="font-weight:bold">Att betala (inkl moms)</td><td style="text-align:right;font-weight:bold">{{total}}</td></tr></tfoot>
</table>
{{#if organizationName}}<p style="color:#777;font-size:13px;margin-top:1.5rem">{{organizationName}}{{#if organizationOrgNumber}} · {{organizationOrgNumber}}{{/if}}</p>{{/if}}
</body></html>`;

export interface GenerateFakturaFromTemplateArgs {
  invoice: FakturaDocInvoice;
  matterId: MatterId;
  recipient: string;
  meta: FakturaDocMeta;
  register: RegisterMut;
  utils: DocUtils;
}

/**
 * Generera ett faktura-DOKUMENT via TEMPLATE-MOTORN (#852): renderar
 * `FAKTURA_TEMPLATE` med Handlebars mot fakturans kontext → HTML, registrerar
 * (documentType=Faktura, invoiceId) och persisterar bytes:erna. Används av
 * slutreglerings-flödet så klient-/betalar-fakturorna får dokument i fil-listan
 * + länk på faktura-objektet. `document.register` emittar inga events (ingen
 * read-only-trap), funkar i demo + server.
 */
/** Handlebars-kontext för faktura-mallen (utbruten → håller generatorn ≤8). */
function fakturaTemplateContext(
  invoice: FakturaDocInvoice, recipient: string, meta: FakturaDocMeta,
  formatCurrency: (ore: number) => string,
): Record<string, unknown> {
  const vatOre = invoice.vatOre ?? 0;
  const date = (invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date()).toLocaleDateString("sv-SE");
  return {
    invoiceNumber: invoice.invoiceNumber ?? "—",
    ocr: invoice.ocrReference ?? "",
    date, matterNumber: meta.matterNumber, matterTitle: meta.matterTitle, recipient,
    net: formatCurrency(invoice.amount - vatOre), vat: formatCurrency(vatOre), total: formatCurrency(invoice.amount),
    organizationName: meta.organizationName ?? "", organizationOrgNumber: meta.organizationOrgNumber ?? "",
  };
}

export async function generateFakturaFromTemplate(args: GenerateFakturaFromTemplateArgs): Promise<void> {
  const { invoice, matterId, recipient, meta, register, utils } = args;
  const { renderHandlebars } = await import("@/lib/client/kostnadsrakning/render-handlebars");
  const { persistGeneratedDoc } = await import("@/lib/client/demo/persist-generated-doc");
  const { formatCurrency } = await import("@/lib/client/utils");
  const html = renderHandlebars(FAKTURA_TEMPLATE, fakturaTemplateContext(invoice, recipient, meta, formatCurrency));
  const bytes = new TextEncoder().encode(html);
  const docId = `faktura-${invoice.id}`;
  const fileName = `Faktura ${invoice.invoiceNumber ?? meta.matterNumber} ${new Date().toISOString().slice(0, 10)}.html`;
  const storagePath = `documents/content/${docId}.html`;
  await register.mutateAsync({
    id: asId<"DocumentId">(docId), matterId, fileName, mimeType: "text/html; charset=utf-8",
    sizeBytes: bytes.byteLength, storagePath, documentType: "Faktura", invoiceId: invoice.id, analysisStatus: "DONE",
  });
  await persistGeneratedDoc({ id: docId, storagePath, fileName, mimeType: "text/html; charset=utf-8", bytes });
  try {
    await utils.document.tree.invalidate({ matterId });
    await utils.document.tree.refetch({ matterId });
    await utils.document.list.invalidate();
  } catch { /* best-effort */ }
}

export async function generateFakturaDoc(args: GenerateFakturaDocArgs): Promise<void> {
  const { invoice, matterId, meta, register, utils } = args;
  const { renderFakturaPdf } = await import("@/lib/client/kostnadsrakning/render-faktura-pdf");
  const { persistGeneratedDoc } = await import("@/lib/client/demo/persist-generated-doc");
  const bytes = await renderFakturaPdf({
    invoice,
    meta: {
      matterNumber: meta.matterNumber, matterTitle: meta.matterTitle,
      ...omitUndefined({
        clientName: meta.clientName,
        recipient: meta.recipient,
        organizationName: meta.organizationName,
        organizationOrgNumber: meta.organizationOrgNumber,
      }),
    },
  });
  const docId = `faktura-${invoice.id}`;
  const fileName = `Faktura ${meta.matterNumber} ${new Date().toISOString().slice(0, 10)}.pdf`;
  const storagePath = `documents/content/${docId}.pdf`;
  await register.mutateAsync({
    id: asId<"DocumentId">(docId), matterId, fileName, mimeType: "application/pdf",
    sizeBytes: bytes.byteLength, storagePath, documentType: "Faktura",
    invoiceId: invoice.id, analysisStatus: "DONE",
  });
  await persistGeneratedDoc({ id: docId, storagePath, fileName, mimeType: "application/pdf", bytes });
  try {
    await utils.document.tree.invalidate({ matterId });
    await utils.document.tree.refetch({ matterId });
    await utils.document.list.invalidate();
  } catch { /* best-effort */ }
}
