"use client";

/**
 * `generateKrDoc` (#828 steg 4) — generera ett kostnadsräknings-DOKUMENT (PDF)
 * för rättshjälp och lägg det i ärendets fil-lista, parallellt med
 * KOSTNADSRAKNING-billing-run:en.
 *
 * Rättshjälpens KR värderas på timkostnadsnormen (inte brottmålstaxan) →
 * `isTaxeArende: false` i `buildKostnadsrakningContext` ger arvode =
 * timkostnadsnorm × billable tid. Ingen huvudförhandling (hufStart = hufEnd).
 *
 * Använder `document.register` (inga events → ingen read-only-trap) precis som
 * `generateFakturaDoc`, så det funkar i både demo- och git/server-backend.
 */

import { omitUndefined } from "@/lib/shared/omit-undefined";
import { KOSTNADSRAKNING_DOCUMENT_TYPE } from "@/lib/shared/schemas/document";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import type { DocUtils, RegisterMut } from "./generate-faktura-doc";

export interface KrDocMeta {
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  courtName?: string;
  defenderName: string;
  defenderEmail?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  organizationAddress?: string;
  /** Rättshjälp: rådgivningstimmen betald separat → transparens-rad. */
  radgivningPaid?: boolean;
}

export interface KrDocExpense {
  id: string; date: string | Date; description: string;
  amount: number; vatRate?: number; vatIncluded?: boolean; billable?: boolean;
}
export interface KrDocTimeEntry {
  id: string; date: string | Date; description: string; minutes: number; billable?: boolean;
}

export interface GenerateKrDocArgs {
  matterId: MatterId;
  meta: KrDocMeta;
  expenses: readonly KrDocExpense[];
  timeEntries: readonly KrDocTimeEntry[];
  register: RegisterMut;
  utils: DocUtils;
}

export async function generateKrDoc(args: GenerateKrDocArgs): Promise<void> {
  const { matterId, meta, expenses, timeEntries, register, utils } = args;
  const { buildKostnadsrakningContext } = await import("@/lib/shared/kostnadsrakning");
  const { renderKostnadsrakningPdf } = await import("@/lib/client/kostnadsrakning/render-pdf");
  const { persistGeneratedDoc } = await import("@/lib/client/demo/persist-generated-doc");

  const now = new Date();
  const ctx = buildKostnadsrakningContext({
    matter: { matterNumber: meta.matterNumber, title: meta.matterTitle, ...omitUndefined({ clientName: meta.clientName, radgivningPaid: meta.radgivningPaid }) },
    defender: { name: meta.defenderName, ...omitUndefined({ email: meta.defenderEmail }) },
    organization: omitUndefined({ name: meta.organizationName, orgNumber: meta.organizationOrgNumber, address: meta.organizationAddress }),
    ...omitUndefined({ courtName: meta.courtName }),
    // Ingen huvudförhandling i rättshjälps-KR:n — arvodet kommer ur tidsposterna.
    hufStart: now, hufEnd: now,
    isTaxeArende: false,
    expenses,
    timeEntries,
  });

  const bytes = await renderKostnadsrakningPdf({
    result: ctx,
    meta: {
      matterNumber: meta.matterNumber, matterTitle: meta.matterTitle,
      clientName: meta.clientName ?? "", courtName: meta.courtName ?? "",
      defenderName: meta.defenderName,
      ...omitUndefined({ organizationName: meta.organizationName, organizationOrgNumber: meta.organizationOrgNumber }),
    },
  });

  const docId = `kostn-${matterId}-${now.getTime().toString(36)}`;
  const fileName = `Kostnadsräkning ${meta.matterNumber} ${now.toISOString().slice(0, 10)}.pdf`;
  const storagePath = `documents/content/${docId}.pdf`;
  await register.mutateAsync({
    id: asId<"DocumentId">(docId), matterId, fileName, mimeType: "application/pdf",
    sizeBytes: bytes.byteLength, storagePath, documentType: KOSTNADSRAKNING_DOCUMENT_TYPE,
    analysisStatus: "DONE",
  });
  await persistGeneratedDoc({ id: docId, storagePath, fileName, mimeType: "application/pdf", bytes });
  try {
    await utils.document.tree.invalidate({ matterId });
    await utils.document.tree.refetch({ matterId });
    await utils.document.list.invalidate();
  } catch { /* best-effort */ }
}
