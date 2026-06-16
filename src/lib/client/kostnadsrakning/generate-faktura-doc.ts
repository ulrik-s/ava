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
  id: string;
  amount: number;
  invoiceNumber?: string | null | undefined;
  ocrReference?: string | null | undefined;
  invoiceDate?: string | Date | null | undefined;
}

export interface GenerateFakturaDocArgs {
  invoice: FakturaDocInvoice;
  matterId: string;
  meta: FakturaDocMeta;
  register: RegisterMut;
  utils: DocUtils;
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
    id: docId, matterId, fileName, mimeType: "application/pdf",
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
