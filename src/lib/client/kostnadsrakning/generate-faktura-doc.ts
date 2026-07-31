"use client";

/**
 * `generateFakturaFromTemplate` (#397/#852) — generera ett faktura-DOKUMENT ur en
 * nyss skapad Invoice-entitet och lägg det i ärendets fil-lista, parallellt med
 * Invoice-objektet. `document.register` emittar inga events (ingen read-only-trap),
 * så detta funkar i både demo- och git-backend.
 *
 * HTML:en kommer ur den DELADE mallen (`faktura-template.ts`, #937) — samma
 * renderare som demo-generatorn använder, så varje faktura i systemet har
 * sammanställning på första sidan och specifikation därefter.
 */

import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/lib/server/routers/_app";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import type { FakturaBreakdown, FakturaDocInvoice, FakturaDocMeta, InvoiceSpecification } from "./faktura-template";

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

export interface GenerateFakturaFromTemplateArgs {
  invoice: FakturaDocInvoice;
  matterId: MatterId;
  recipient: string;
  meta: FakturaDocMeta;
  register: RegisterMut;
  utils: DocUtils;
  /** Fakturaspecifikationen (#856) — tider/utlägg/avdragna aconton. Utelämnas
   *  för rena aconto-fakturor → sammanställningen faller tillbaka på `notes`. */
  spec?: InvoiceSpecification | null | undefined;
  /** Itemiserad summering (#858) — självförklarande nedbrytning (självrisk,
   *  rådgivning, prutning, aconton). När satt renderas den som uppdelningen
   *  mellan klient och betalare i stället för spec-summeringen. */
  breakdown?: FakturaBreakdown | null | undefined;
}

/**
 * Generera ett faktura-DOKUMENT via TEMPLATE-MOTORN (#852/#937): renderar den
 * delade faktura-mallen mot fakturans kontext → HTML, registrerar
 * (documentType=Faktura, invoiceId) och persisterar bytes:erna. Används av ALLA
 * fakturaflöden (aconto, rådgivning, slutreglering, dom) så klient-/betalar-
 * fakturorna får dokument i fil-listan + länk på faktura-objektet.
 */
export async function generateFakturaFromTemplate(args: GenerateFakturaFromTemplateArgs): Promise<void> {
  const { invoice, matterId, recipient, meta, register, utils, spec, breakdown } = args;
  const { renderFakturaHtml } = await import("./faktura-template");
  const { persistGeneratedDoc } = await import("@/lib/client/demo/persist-generated-doc");
  const html = renderFakturaHtml({ invoice, recipient, meta, spec, breakdown });
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
