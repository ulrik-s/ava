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

/** Bokföringsroller som faktura-domänen känner till (systemoberoende).
 *  Utgående moms är uppdelad per sats (#790) så SIE/verifikat bokför på rätt
 *  momskonto (25 % → 2611, 12 % → 2612, 6 % → 2613). `momsUtgaende` = 25 %. */
export type VoucherRole =
  | "kundfordran"
  | "intaktArvode"
  | "intaktUtlagg"
  | "momsUtgaende"
  | "momsUtgaende12"
  | "momsUtgaende06";

/** En rad i fakturans moms-uppdelning per sats (#790). */
export interface VatBreakdownLine {
  /** Arvode (alltid 25 %) eller (vidarefakturerat) utlägg (egen sats). */
  kind: "arvode" | "utlagg";
  /** Moms-sats i basis points (0/600/1200/2500). */
  vatRate: number;
  /** Netto (exkl moms) i öre. */
  netOre: number;
  /** Moms i öre. */
  vatOre: number;
}

/** Moms-roll för en sats; null = momsfritt (ingen moms-rad). */
function momsRoleForRate(vatRate: number): VoucherRole | null {
  if (vatRate >= 2500) return "momsUtgaende";
  if (vatRate >= 1200) return "momsUtgaende12";
  if (vatRate >= 600) return "momsUtgaende06";
  return null;
}

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
  /** Exakt momsbelopp i öre (per sats, #782). Saknas på äldre fakturor → 25 %-split. */
  vatOre?: number | null;
  /** Moms-uppdelning per sats (#790). Finns → verifikatet bokför moms per
   *  momskonto + delar intäkt i arvode/utlägg. Saknas → enkel rad via vatOre. */
  vatBreakdown?: VatBreakdownLine[] | null;
  invoiceDate: Date | string;
  invoiceNumber?: string | null;
  /** AVA-ärendenummer — skrivs i verifikatets titel/beskrivning (#785). */
  matterNumber?: string | null;
}

function semanticRow(role: VoucherRole, ore: number, debit: boolean): SemanticVoucherRow {
  return { role, debit: debit ? ore : 0, credit: debit ? 0 : ore };
}

/**
 * Rad där BELOPPETS TECKEN avgör sidan (#977): positivt belopp hamnar på rollens
 * naturliga sida, negativt på den motsatta.
 *
 * Det är vad som gör kreditfakturor till samma kod som debetfakturor. Förr
 * vändes HELA verifikatet med en global flagga, vilket bara fungerar när alla
 * poster går åt samma håll. En kreditering av en slutfaktura gör inte det: den
 * kan samtidigt MINSKA arvodesintäkten (acontot vänds) och ÖKA utläggsintäkten
 * (utlägget fanns inte i acontot). Med ett globalt tecken går den nyansen
 * förlorad och beloppen klumpas ihop på fel konton.
 */
function signedRow(role: VoucherRole, ore: number, naturalDebit: boolean): SemanticVoucherRow {
  const onDebit = ore >= 0 ? naturalDebit : !naturalDebit;
  return semanticRow(role, Math.abs(ore), onDebit);
}

/**
 * Per-sats-verifikat (#790): intäkt delas arvode/utlägg, moms per momskonto.
 * Balans följer av att brutto = Σnetto + Σmoms ur samma breakdown.
 *
 * Hanterar NEGATIVA rader (#977) — en kreditfaktura bär sin uppdelning med
 * omvända tecken, precis som en kreditnota ska spegla originalet post för post.
 */
function buildPerRateRows(breakdown: VatBreakdownLine[]): SemanticVoucherRow[] {
  const arvodeNet = breakdown.filter((l) => l.kind === "arvode").reduce((s, l) => s + l.netOre, 0);
  const utlaggNet = breakdown.filter((l) => l.kind === "utlagg").reduce((s, l) => s + l.netOre, 0);
  const momsByRole = new Map<VoucherRole, number>();
  for (const l of breakdown) {
    const role = momsRoleForRate(l.vatRate);
    if (role && l.vatOre !== 0) momsByRole.set(role, (momsByRole.get(role) ?? 0) + l.vatOre);
  }
  const brutto = arvodeNet + utlaggNet + breakdown.reduce((s, l) => s + l.vatOre, 0);
  const rows = [
    semanticRow("kundfordran", Math.abs(brutto), brutto >= 0),
    signedRow("intaktArvode", arvodeNet, false),
    signedRow("intaktUtlagg", utlaggNet, false),
  ];
  for (const [role, ore] of momsByRole) rows.push(signedRow(role, ore, false));
  return rows.filter((r) => r.debit > 0 || r.credit > 0);
}

/**
 * Bygg ett semantiskt verifikat ur en kundfaktura. Ren funktion, noll I/O.
 *
 * Momsen tas exakt från `invoice.vatOre` när den finns (beräknad per sats vid
 * skapande, #782) — annars faller vi tillbaka på en `vatRate`-split av bruttot
 * (äldre fakturor / fixtures). Balans garanteras: moms = brutto − netto.
 */
export function buildSemanticVoucher(
  invoice: SemanticVoucherInput,
  vatRate: VatRate = 2500,
): SemanticVoucher {
  // Per-sats-vägen läser tecknet ur RADERNA (#977); enkelrads-vägen har bara
  // `amount` att gå på och behöver därför fortfarande den globala flaggan.
  const rows = invoice.vatBreakdown && invoice.vatBreakdown.length > 0
    ? buildPerRateRows(invoice.vatBreakdown)
    : buildSingleRateRows(invoice, vatRate, invoice.amount >= 0);

  return {
    date: invoice.invoiceDate,
    description: voucherDescription(invoice),
    rows,
  };
}

/**
 * Verifikatets titel: AVA-ärendenumret först (#785), sedan ev. fakturanummer.
 *
 * Separatorn är ett vanligt bindestreck, INTE `·` (U+00B7). Fortnox avvisar
 * mittpunkten med `400 … code 2000359 "Värdet innehåller ej tillåtna tecken"`
 * — verifierat skarpt 2026-09-05 (#1043). Åäö går bra; det är just den
 * exotiska interpunktionen som fälls. Byt inte tillbaka för snyggheten skull.
 */
function voucherDescription(invoice: SemanticVoucherInput): string {
  const faktura = invoice.invoiceNumber ? `Faktura ${invoice.invoiceNumber}` : "Kundfaktura (AVA)";
  return invoice.matterNumber ? `Ärende ${invoice.matterNumber} - ${faktura}` : faktura;
}

/**
 * Enkel-rads-verifikat för fakturor UTAN uppdelning: äldre rader från före #782
 * och testfixturer. Momsen tas ur `vatOre` när den finns, annars ur en split.
 *
 * `Math.min` nedan är en fallback för INKONSISTENT ÄLDRE DATA — den klipper
 * momsen så verifikatet åtminstone balanserar. Den får inte tolkas som en
 * generell garanti: fram till #977 gick kreditfakturor den här vägen, och då
 * kunde klippningen tyst svälja en riktig momsvändning. Krediter bär numera en
 * egen uppdelning och tar per-sats-vägen.
 */
function buildSingleRateRows(invoice: SemanticVoucherInput, vatRate: VatRate, kundfordranDebit: boolean): SemanticVoucherRow[] {
  const bruttoOre = Math.abs(invoice.amount);
  const momsOre = invoice.vatOre != null
    ? Math.min(Math.abs(invoice.vatOre), bruttoOre)
    : bruttoOre - splitVat({ amount: bruttoOre, vatRate, vatIncluded: true }).exclVat;
  const exclVat = bruttoOre - momsOre; // balans-säker rest
  return [
    semanticRow("kundfordran", bruttoOre, kundfordranDebit),
    semanticRow("intaktArvode", exclVat, !kundfordranDebit),
    semanticRow("momsUtgaende", momsOre, !kundfordranDebit),
  ].filter((r) => r.debit > 0 || r.credit > 0); // släng 0-rader (t.ex. moms vid 0 %)
}
