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
 * Kreditfaktura (negativt belopp) vänder debet/kredit. Σdebet == Σkredit
 * gäller för varje verifikat som byggs: enkelradsvägen räknar moms som
 * brutto − netto (ingen avrundnings-glipa), och per-sats-vägen bokför varje
 * rads moms på satsens eget momskonto. En uppdelning med moms på en sats utan
 * momskonto (bara 6, 12 och 25 % har ett) ger ett fel i stället för ett
 * obalanserat verifikat (#1902).
 *
 * Alla belopp är i ÖRE (heltal) — precis som i resten av domänen. Öre→SEK
 * (eller annan presentation) sker först i renderaren.
 */

import { hasVatBreakdown, invoiceVatOre } from "@/lib/shared/invoice-vat";
import { formatOreAsKr } from "@/lib/shared/kr-format";
import type { VatRate } from "@/lib/shared/vat";

/** Bokföringsroller som faktura-domänen känner till (systemoberoende).
 *  Utgående moms är uppdelad per sats (#790) så SIE/verifikat bokför på rätt
 *  momskonto (25 % → 2611, 12 % → 2612, 6 % → 2613). `momsUtgaende` = 25 %. */
export type VoucherRole =
  | "kundfordran"
  | "intaktArvode"
  | "intaktUtlagg"
  | "momsUtgaende"
  | "momsUtgaende12"
  | "momsUtgaende06"
  /** Bankkontot en kundbetalning kommer in på (#1173). */
  | "bank";

/** En rad i fakturans moms-uppdelning per sats (#790). */
export interface VatBreakdownLine {
  /** Arvode (alltid 25 %) eller (vidarefakturerat) utlägg (egen sats). */
  kind: "arvode" | "utlagg";
  /**
   * Moms-sats i basis points (0/600/1200/2500). Bara 600, 1200 och 2500 har ett
   * momskonto: en rad med moms (`vatOre ≠ 0`) på en annan sats ger ett fel när
   * verifikatet byggs, så att Σdebet == Σkredit gäller för varje verifikat (#1902).
   */
  vatRate: number;
  /** Netto (exkl moms) i öre. */
  netOre: number;
  /** Moms i öre. */
  vatOre: number;
}

/** Satsens momskonto, exakt (#1902): 25, 12 och 6 %. Alla andra satser saknar konto. */
const MOMS_ROLE_BY_RATE: ReadonlyMap<number, VoucherRole> = new Map([
  [2500, "momsUtgaende"],
  [1200, "momsUtgaende12"],
  [600, "momsUtgaende06"],
]);

/** Moms-roll för en sats; null = satsen saknar momskonto. */
function momsRoleForRate(vatRate: number): VoucherRole | null {
  return MOMS_ROLE_BY_RATE.get(vatRate) ?? null;
}

/**
 * Momskontot för en rad som bär moms (#1902). En sats utan momskonto kastar ett
 * vanligt `Error`: momsen kan inte bokföras, och verifikatet skulle inte balansera.
 */
function momsRoleOf(line: VatBreakdownLine, description: string): VoucherRole {
  const role = momsRoleForRate(line.vatRate);
  if (role) return role;
  const sats = String(line.vatRate / 100).replace(".", ",");
  throw new Error(
    `${description}: en rad i momsuppdelningen har ${formatOreAsKr(line.vatOre)} moms på satsen ${sats} %, ` +
    "som saknar momskonto (bara 6, 12 och 25 % har ett). " +
    "Verifikatet skulle inte balansera, så fakturan kan inte bokföras förrän momsuppdelningen är rättad.",
  );
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
  /** Exakt momsbelopp i öre (per sats, #782). Tolkas av `invoiceVatOre` (#1806). */
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
 * En rad utan moms bokförs bara som intäkt, oavsett sats; en rad med moms på en
 * sats utan momskonto kastar (#1902, `momsRoleOf`).
 */
function buildPerRateRows(breakdown: VatBreakdownLine[], description: string): SemanticVoucherRow[] {
  const arvodeNet = breakdown.filter((l) => l.kind === "arvode").reduce((s, l) => s + l.netOre, 0);
  const utlaggNet = breakdown.filter((l) => l.kind === "utlagg").reduce((s, l) => s + l.netOre, 0);
  const momsByRole = new Map<VoucherRole, number>();
  for (const l of breakdown.filter((line) => line.vatOre !== 0)) {
    const role = momsRoleOf(l, description);
    momsByRole.set(role, (momsByRole.get(role) ?? 0) + l.vatOre);
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
  const description = voucherDescription(invoice);
  const rows = hasVatBreakdown(invoice)
    ? buildPerRateRows(invoice.vatBreakdown, description)
    : buildSingleRateRows(invoice, vatRate, invoice.amount >= 0);

  return { date: invoice.invoiceDate, description, rows };
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
  // Samma tolkning som fakturadokumentet (#1806); klippningen är verifikatets egen.
  const momsOre = Math.min(Math.abs(invoiceVatOre(invoice, vatRate)), bruttoOre);
  const exclVat = bruttoOre - momsOre; // balans-säker rest
  return [
    semanticRow("kundfordran", bruttoOre, kundfordranDebit),
    semanticRow("intaktArvode", exclVat, !kundfordranDebit),
    semanticRow("momsUtgaende", momsOre, !kundfordranDebit),
  ].filter((r) => r.debit > 0 || r.credit > 0); // släng 0-rader (t.ex. moms vid 0 %)
}

/** En registrerad kundbetalning mot en faktura (#1173). */
export interface PaymentVoucherInput {
  /** Inbetalt belopp i öre (negativt = återbetalning). */
  amount: number;
  paidAt: Date | string;
  invoiceNumber?: string | null;
  matterNumber?: string | null;
}

/**
 * Inbetalning: bank DEBET, kundfordran KREDIT. Varje delbetalning är ett eget
 * verifikat, så kundfordran nettar till noll när fakturan är fullt betald.
 */
export function buildPaymentVoucher(payment: PaymentVoucherInput): SemanticVoucher {
  const faktura = payment.invoiceNumber ? `Inbetalning faktura ${payment.invoiceNumber}` : "Inbetalning (AVA)";
  return {
    date: payment.paidAt,
    description: payment.matterNumber ? `Ärende ${payment.matterNumber} - ${faktura}` : faktura,
    rows: [signedRow("bank", payment.amount, true), signedRow("kundfordran", payment.amount, false)],
  };
}
