/**
 * Fakturans brevhuvud och sidfot i vy-modellen (#2255; intag #149/#150): det
 * byråns fakturamall visar utöver beloppen — mottagarens postadress i
 * fönsterkuvertet, klienten, förfallodagen och byråns uppgifter i sidfoten
 * (telefon, webbplats, bankgiro, momsregistreringsnummer, sigill).
 *
 * Bara presentation: inga belopp räknas här. Byråns uppgifter kommer ur
 * organisationsinställningarna (`fakturaOrgMeta`), aldrig ur mallen.
 */

import { displayWebsite, vatNumberFromOrgNumber } from "@/lib/shared/billing/kostnadsrakning-document";
import { svd as svDate } from "@/lib/shared/billing/settlement-view";
import type { OrgImage } from "@/lib/shared/org-image";

/** Byråns och mottagarens uppgifter som brevhuvudet och sidfoten läser. */
export interface FakturaLetterMeta {
  /** Klienten ärendet gäller — "Klient:" i uppgiftsblocket. */
  clientName?: string;
  /** Mottagarens postadress (kontaktens adressfält), radbruten eller med komman. */
  recipientAddress?: string;
  organizationOrgNumber?: string;
  organizationPhone?: string;
  /** Webbplats, t.ex. "https://www.exempel.se" — visas som "www.exempel.se". */
  organizationWebsite?: string;
  organizationBankgiro?: string;
  /** Märket till vänster i sidfoten (t.ex. advokatsamfundets sigill). */
  organizationFooterSeal?: OrgImage;
}

/** Fakturans fält som brevhuvudet läser. */
export interface FakturaLetterInvoice {
  amount: number;
  dueDate?: string | Date | null | undefined;
}

/** Brevhuvudets och sidfotens färdiga fält. Tom sträng = uppgiften saknas (raden utelämnas). */
export interface FakturaLetterFields {
  /** Mottagarens namn och postadress, en rad per rad i fönsterkuvertet. */
  recipientLines: string[];
  clientName: string;
  dueDate: string;
  /** Ska fakturan betalas (belopp > 0)? Styr betalningsuppmaningen och räntetexten. */
  payable: boolean;
  organizationPhone: string;
  organizationWebsite: string;
  organizationBankgiro: string;
  /** Momsregistreringsnumret, härlett ur org.nr (SE + 10 siffror + 01). */
  organizationVatNumber: string;
  /** Sidfotens sigill; null → sidfoten utan bild. */
  footerSeal: OrgImage | null;
}

/**
 * En postadress i rader: radbrytningar gäller, annars delar komman
 * ("Storgatan 1, 222 22 Lund" → två rader). Tomma delar utelämnas.
 */
export function postalAddressLines(address: string | null | undefined): string[] {
  const text = (address ?? "").trim();
  const parts = text.includes("\n") ? text.split(/\r?\n/) : text.split(",");
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** Byråns uppgifter i sidfoten; saknade blir tomma. */
function footerFields(meta: FakturaLetterMeta): Omit<FakturaLetterFields, "recipientLines" | "clientName" | "dueDate" | "payable"> {
  return {
    organizationPhone: meta.organizationPhone ?? "",
    organizationWebsite: displayWebsite(meta.organizationWebsite) ?? "",
    organizationBankgiro: meta.organizationBankgiro ?? "",
    organizationVatNumber: vatNumberFromOrgNumber(meta.organizationOrgNumber) ?? "",
    footerSeal: meta.organizationFooterSeal ?? null,
  };
}

/** Brevhuvudets och sidfotens fält ur fakturan, mottagaren och byråns uppgifter. */
export function buildLetterFields(invoice: FakturaLetterInvoice, recipient: string, meta: FakturaLetterMeta): FakturaLetterFields {
  return {
    recipientLines: [recipient, ...postalAddressLines(meta.recipientAddress)].filter((l) => l.trim() !== ""),
    clientName: meta.clientName ?? "",
    dueDate: svDate(invoice.dueDate),
    payable: invoice.amount > 0,
    ...footerFields(meta),
  };
}
