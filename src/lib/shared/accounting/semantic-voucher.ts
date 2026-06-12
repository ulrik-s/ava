/**
 * Semantiskt verifikat (domänmodell) — systemoberoende (#235, ADR 0011).
 *
 * En kundfaktura blir ett balanserat verifikat mot SEMANTISKA ROLLER, inte
 * mot kontonummer. Roll→konto är ett renderar-beslut (Fortnox-connectorn,
 * SIE-export, …) och hör INTE hemma här. Den här modellen vet alltså inget
 * om Fortnox, kontoplaner eller verifikatserier.
 *
 * Standard kundfaktura (brutto, inkl moms) → balanserat verifikat:
 *   Debet  kundfordran      = brutto
 *   Kredit intäkt (arvode)  = netto (exkl moms)
 *   Kredit utgående moms     = moms
 *
 * Kreditfaktura (negativt belopp) vänder debet/kredit. Balans GARANTERAS
 * genom att moms räknas som brutto − netto (ingen avrundnings-glipa), så
 * invarianten Σdebet == Σkredit == |fakturabelopp| alltid håller.
 *
 * Alla belopp är i ÖRE (heltal) — precis som i resten av domänen. Öre→SEK
 * (eller annan presentation) sker först i renderaren.
 */

import { splitVat, type VatRate } from "@/lib/shared/vat";

/** Bokföringsroller som faktura-domänen känner till (systemoberoende). */
export type VoucherRole = "kundfordran" | "intaktArvode" | "momsUtgaende" | "intaktUtlagg";

/** En verifikatrad mot en roll. Exakt EN av debit/credit > 0 (öre, heltal). */
export interface SemanticVoucherRow {
  role: VoucherRole;
  /** Debet i öre. */
  debit: number;
  /** Kredit i öre. */
  credit: number;
}

/** Ett balanserat verifikat uttryckt i roller + öre. Inget systemberoende. */
export interface SemanticVoucher {
  /** Bokföringsdatum (domändatum — renderaren formaterar). */
  date: Date | string;
  /** Verifikat-beskrivning (människoläsbar). */
  description: string;
  /** Balanserade rader (Σdebit == Σcredit i öre). */
  rows: SemanticVoucherRow[];
}

/** Minsta fält som behövs för att bygga ett verifikat — frikopplat från Invoice. */
export interface SemanticVoucherInput {
  /** Brutto i öre (negativt = kreditfaktura). */
  amount: number;
  invoiceDate: Date | string;
  invoiceNumber?: string | null;
}

function semanticRow(role: VoucherRole, ore: number, debit: boolean): SemanticVoucherRow {
  return { role, debit: debit ? ore : 0, credit: debit ? 0 : ore };
}

/**
 * Bygg ett semantiskt verifikat ur en kundfaktura. Ren funktion, noll I/O.
 * Endast en VAT-sats i taget (default 25 %); flersats-/utläggs-uppdelning
 * läggs till när fakturarader kopplas in (uppföljning på #233).
 */
export function buildSemanticVoucher(
  invoice: SemanticVoucherInput,
  vatRate: VatRate = 2500,
): SemanticVoucher {
  const bruttoOre = Math.abs(invoice.amount);
  const { exclVat } = splitVat({ amount: bruttoOre, vatRate, vatIncluded: true });
  const momsOre = bruttoOre - exclVat; // balans-säker rest
  const kundfordranIsDebit = invoice.amount >= 0; // kreditfaktura vänder

  const rows = [
    semanticRow("kundfordran", bruttoOre, kundfordranIsDebit),
    semanticRow("intaktArvode", exclVat, !kundfordranIsDebit),
    semanticRow("momsUtgaende", momsOre, !kundfordranIsDebit),
  ].filter((r) => r.debit > 0 || r.credit > 0); // släng 0-rader (t.ex. moms vid 0 %)

  return {
    date: invoice.invoiceDate,
    description: invoice.invoiceNumber ? `Faktura ${invoice.invoiceNumber}` : "Kundfaktura (AVA)",
    rows,
  };
}
