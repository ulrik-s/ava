"use client";

/**
 * `generateFakturaFromTemplate` (#397/#852) — generera ett faktura-DOKUMENT ur en
 * nyss skapad Invoice-entitet och lägg det i ärendets fil-lista, parallellt med
 * Invoice-objektet. `document.register` emittar inga events (ingen read-only-trap),
 * så detta funkar i både demo- och git-backend.
 *
 * Dokumentet är en PDF (#1439) ur den DELADE vy-modellen (`buildFakturaView`,
 * #937/#938) och PDF-renderaren (`renderFakturaPdf`) — samma som demo-
 * generatorn och fakturautskicket använder, så varje faktura i systemet har
 * sammanställning på första sidan och specifikation därefter. Inga nya
 * HTML-dokument skapas; äldre HTML-fakturor ligger kvar orörda.
 */

import type { inferRouterInputs } from "@trpc/server";
import { finalInvoiceNumber } from "@/lib/client/billing/invoice-number-finality";
import type { AppRouter } from "@/lib/server/routers/_app";
import { asId, type MatterId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
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
  /** Skjut upp dokumentet om numret inte är fastställt (default). `false` = hoppa över i stället. */
  deferIfPending?: boolean;
}

/** Fakturadokumentets format (#1439) — alltid PDF. */
const FAKTURA_MIME = "application/pdf";

/** Utfallet: skapat, uppskjutet (numret inte fastställt) eller överhoppat (väntar redan). */
export type FakturaDocOutcome = "generated" | "deferred" | "pending";

/**
 * Generera ett faktura-DOKUMENT (#852/#937): bygger fakturans vy-modell och
 * renderar den till PDF (#1439), registrerar
 * (documentType=Faktura, invoiceId) och persisterar bytes:erna. Används av ALLA
 * fakturaflöden (aconto, rådgivning, slutreglering, dom) så klient-/betalar-
 * fakturorna får dokument i fil-listan + länk på faktura-objektet.
 */
export async function generateFakturaFromTemplate(args: GenerateFakturaFromTemplateArgs): Promise<FakturaDocOutcome> {
  const { matterId, recipient, meta, register, utils, spec, breakdown } = args;
  // Fakturanumret sätts av servern (#1243): dokumentet bär numret, så det
  // skapas först när numret är fastställt — annars skjuts det upp till synk.
  const number = await finalInvoiceNumber(args.invoice.id);
  if (number.state === "pending") {
    if (args.deferIfPending === false) return "pending";
    const { deferFakturaDoc } = await import("@/lib/client/billing/deferred-faktura-docs");
    await deferFakturaDoc({ invoiceId: args.invoice.id, invoice: args.invoice, matterId, recipient, meta, spec, breakdown });
    return "deferred";
  }
  const invoice = number.state === "final"
    ? { ...args.invoice, invoiceNumber: number.invoiceNumber, ocrReference: number.ocrReference }
    : args.invoice;
  const { buildFakturaView } = await import("./faktura-template");
  const { renderFakturaPdf } = await import("./render-faktura-pdf");
  const { persistGeneratedDoc } = await import("@/lib/client/demo/persist-generated-doc");
  const bytes = await renderFakturaPdf(buildFakturaView({ invoice, recipient, meta, spec, breakdown }));
  // uuid — servern lagrar bara uuid-nycklade rader (#1124; fakturan missades där).
  const docId = uuidv7();
  const fileName = `Faktura ${invoice.invoiceNumber ?? meta.matterNumber} ${new Date().toISOString().slice(0, 10)}.pdf`;
  const storagePath = `documents/content/${docId}.pdf`;
  await register.mutateAsync({
    id: asId<"DocumentId">(docId), matterId, fileName, mimeType: FAKTURA_MIME,
    sizeBytes: bytes.byteLength, storagePath, documentType: "Faktura", invoiceId: invoice.id, analysisStatus: "DONE",
  });
  await persistGeneratedDoc({ id: docId, storagePath, fileName, mimeType: FAKTURA_MIME, bytes });
  try {
    await utils.document.tree.invalidate({ matterId });
    await utils.document.tree.refetch({ matterId });
    await utils.document.list.invalidate();
  } catch { /* best-effort */ }
  return "generated";
}
