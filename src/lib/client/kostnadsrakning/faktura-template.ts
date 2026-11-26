/**
 * Faktura-mallen — EN källa för ALLA fakturor (#937/#938).
 *
 * Upplägget är detsamma oavsett fakturatyp och betalningssätt:
 *   sida 1  Sammanställning — en rad per arvodeskategori + timpris, läst som
 *           en uträkning (benämning | tim | timpris | belopp), och sedan en
 *           kedja där varje summa = raderna ovanför (#1200): summa arvode exkl
 *           moms → moms på arvode → utlägg exkl moms → moms på utlägg → äkta
 *           utlägg → summa inkl moms. Därefter uppdelningen mellan klient och
 *           betalare (domstol/försäkringsbolag) → att betala.
 *   sida 2+ Specifikation — tidsspecifikation per arvodeskategori (arvode,
 *           tidsspillan …) med delsumma + utläggsspecifikation, dvs underlaget
 *           till beloppen på sida 1. Timpriset står EN gång per kategori i
 *           sammanställningen, inte på varje post (#1439).
 *
 * `buildFakturaView` är den TYPADE vy-modellen (#938): färdigformaterade rader,
 * inga öre kvar. PDF:en (`renderFakturaPdf`) är fakturans enda format sedan
 * #1439 — samma renderare för det arkiverade dokumentet och bilagan som mejlas,
 * så etiketter och belopp kan inte glida isär.
 *
 * KOSTNADSRÄKNINGEN till domstol har en EGEN mall (`buildKostnadsrakningContext`)
 * — den är en myndighetsblankett, inte en faktura, och berörs inte här.
 */

import { formatCurrency } from "@/lib/client/utils";
import { isPerDayKind } from "@/lib/shared/brottmalstaxa";
import { CHARGED_EXPENSE_VAT_RATE } from "@/lib/shared/expense-vat";
import { ARVODE_VAT_BIPS } from "@/lib/shared/invoice-calc";
import type { InvoiceSpecification, SpecExpenseLine } from "@/lib/shared/invoice-specification";
import { invoiceVatOre } from "@/lib/shared/invoice-vat";
import type { OrgImage } from "@/lib/shared/org-image";
import { TIME_ENTRY_KIND_LABELS, type AmountRounding, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import { svd as svDate } from "@/lib/shared/settlement-view"; // svensk kalenderdag (#1677)
import {
  expenseTotals, groupByKind, quantityLabel, resolveSpec, specTables, sumOf, unitRateOre,
  type CarriedWorkLine, type Fc, type FakturaExpenseRow, type FakturaTimeGroup, type FakturaTimeRow, type SpecLine,
} from "./faktura-spec-view";

export type { InvoiceSpecification };
export type { FakturaExpenseRow, FakturaTimeGroup, FakturaTimeRow };

/** En rad i den itemiserade summeringen (#858): `add` = delbelopp, `deduct` =
 *  avgår (−), `info` = spårbarhets-rad utan beloppspåverkan (visas parentes). */
export interface BreakdownRow { label: string; amountOre: number; kind: "add" | "deduct" | "info" }

/**
 * Itemiserad summering (#858) — självförklarande nedbrytning (självrisk,
 * rådgivning, prutning, aconton). `timeLines` är det upparbetade arbetet bakom
 * nedbrytningen (#880): fakturor vars arbete ligger på MOTPARTENS faktura
 * (klientens självrisk-faktura, aconton) har inga egna länkade tidsposter, men
 * ska ändå kunna visa specifikationen.
 */
export interface FakturaBreakdown {
  rows: BreakdownRow[];
  totalLabel: string;
  totalOre: number;
  timeLines?: ReadonlyArray<CarriedWorkLine> | undefined;
  /** Nedbrytningens utlägg (#1938) — går före fakturans egna i specifikationen. */
  expenseLines?: ReadonlyArray<SpecExpenseLine> | undefined;
}

export interface FakturaDocMeta {
  matterNumber: string;
  matterTitle: string;
  clientName?: string;
  recipient?: string;
  organizationName?: string;
  organizationOrgNumber?: string;
  /** Byråns logga ur organisationsinställningarna (#1439) — ritas i sidhuvudet. */
  organizationLogo?: OrgImage;
}

export interface FakturaDocInvoice {
  id: InvoiceId;
  amount: number;
  /** Momsbelopp (öre) i `amount`, exakt per sats (#782). Tolkas av `invoiceVatOre` (#1806). */
  vatOre?: number | null | undefined;
  invoiceNumber?: string | null | undefined;
  ocrReference?: string | null | undefined;
  invoiceDate?: string | Date | null | undefined;
  /** Fakturatyp — styr rubriken (Aconto-/Kreditfaktura). Saknas → "Faktura". */
  invoiceType?: string | null | undefined;
  /** Fri text. Blir sammanställningens rad när fakturan saknar itemiserat
   *  arbete (rådgivningstimmen, rena aconton) så beloppet aldrig är oförklarat (#870). */
  notes?: string | null | undefined;
  /** Fakturans radavrundning (#1438) — saknas på äldre fakturor (öre). */
  amountRounding?: AmountRounding | null | undefined;
}

export interface FakturaTemplateArgs {
  invoice: FakturaDocInvoice;
  recipient: string;
  meta: FakturaDocMeta;
  /** Fakturaspecifikationen (#856) — tider/utlägg/avdragna aconton. */
  spec?: InvoiceSpecification | null | undefined;
  /** Itemiserad summering (#858). När satt renderas den som uppdelningen mellan
   *  klient och betalare i stället för spec-summeringen. */
  breakdown?: FakturaBreakdown | null | undefined;
}

// ── Vy-modellen (#938) ──────────────────────────────────────────────────────

/**
 * En rad i sammanställningen: taxegrupp (Benämning | Tim | Timpris | Belopp),
 * utlägg, moms eller en summarad. Tomma sträng-fält betyder "ingen kolumn-
 * uppgift" (utlägg har ingen timtaxa). `subtotal` (#1200) markerar en summarad:
 * den är lika med föregående summarad plus raderna mellan — så kedjan går att
 * räkna efter uppifrån och ned.
 */
export interface FakturaSummaryRow { label: string; rateLabel: string; hours: string; amount: string; subtotal: boolean }

/**
 * En rad i uppdelningen klient/betalare. `style` är en CSS-färg för HTML;
 * `muted` säger åt PDF:en att tona ned raden. `amount` bär redan sin dekoration
 * (−avdrag, (parentes) för info-rader) så båda renderarna skriver den rakt av.
 */
export interface FakturaSplitRow { label: string; amount: string; style: string; muted: boolean }

/** Färdigformaterad faktura — allt en renderare behöver, inga öre kvar. */
export interface FakturaView {
  heading: string;
  invoiceNumber: string;
  ocr: string;
  date: string;
  matterNumber: string;
  matterTitle: string;
  recipient: string;
  organizationName: string;
  organizationOrgNumber: string;
  /** Byråns logga (#1439); null → sidhuvudet utan logga. */
  logo: OrgImage | null;
  /** Rådgivningsnotisen (#870) — tom sträng när den inte gäller. */
  footnote: string;
  summary: FakturaSummaryRow[];
  /** Etiketten på sammanställningens slutsumma ("Summa inkl moms"). */
  summaryTotalLabel: string;
  summaryTotal: string;
  /** Visa rubriken "Uppdelning klient / betalare" (bara vid faktisk split). */
  hasSplit: boolean;
  splitRows: FakturaSplitRow[];
  totalLabel: string;
  total: string;
  /** Finns underlag att specificera → egen sida efter sammanställningen. */
  hasSpec: boolean;
  /** Alla tidsposter i fakturans ordning (platt — för byrå-mallar, #852). */
  timeLines: FakturaTimeRow[];
  /** Tidsposterna per arvodeskategori, i kategori-ordning (#1200). */
  timeGroups: FakturaTimeGroup[];
  /** Visa tidspostens och kategorins belopp (#1939). Falskt på acontofakturan:
   *  där står bara timmarna, och tidsraderna har tomma belopp. */
  showTimeAmounts: boolean;
  expenseLines: FakturaExpenseRow[];
  /** Utläggsspecifikationens summarad (#1506): summan av posternas netto resp.
   *  brutto, formaterade som posterna. Tomma när utlägg saknas. */
  expenseNetTotal: string;
  expenseGrossTotal: string;
}

/** Rubrik (h1 + `<title>` + demo-generatorns filnamn) per fakturatyp. */
export function fakturaHeading(inv: Pick<FakturaDocInvoice, "invoiceType" | "notes">): string {
  if (isRadgivning(inv)) return "Rådgivningsfaktura";
  if (inv.invoiceType === "CREDIT") return "Kreditfaktura";
  if (inv.invoiceType === "ACCONTO") return "Aconto-faktura";
  return "Faktura";
}

/** Är detta en acontofaktura? Den visar tiden utan belopp (#1939). */
function isAcconto(inv: Pick<FakturaDocInvoice, "invoiceType">): boolean {
  return inv.invoiceType === "ACCONTO";
}

/** Är detta rådgivningstimmen (rättshjälpens separata klientdebitering)? */
function isRadgivning(inv: Pick<FakturaDocInvoice, "notes">): boolean {
  return String(inv.notes ?? "").startsWith("Rådgivningstimme");
}

/** Spegel av KR-notisen, sett från klientens sida (#870): klargör att
 *  rådgivningstimmen INTE ligger i kostnadsräkningen till domstolen. */
function footnoteFor(inv: Pick<FakturaDocInvoice, "notes">): string {
  return isRadgivning(inv)
    ? "Rådgivningstimmen (1 tim enligt rättshjälpstaxan) faktureras klienten separat och ingår INTE i kostnadsräkningen till domstolen."
    : "";
}

/** Priset per enhet ("1 500,00 kr/tim" eller "… kr/dygn"); tomt utan pris. */
function rateLabelFor(kind: TimeEntryKind, rateOre: number, fc: Fc): string {
  if (rateOre === 0) return "";
  return `${fc(rateOre)}/${isPerDayKind(kind) ? "dygn" : "tim"}`;
}

/** En kategoris poster per pris per enhet, högsta priset först. */
function linesByRate(lines: readonly SpecLine[]): Array<[number, SpecLine[]]> {
  const byRate = new Map<number, SpecLine[]>();
  for (const l of lines) byRate.set(unitRateOre(l), [...(byRate.get(unitRateOre(l)) ?? []), l]);
  return [...byRate.entries()].sort(([a], [b]) => b - a);
}

/**
 * Sammanställningens arvoderader (#925/#1200): en rad per KATEGORI + pris, som
 * läses som en uträkning (tim × timpris = belopp). Priset ingår i nyckeln så
 * ärenden som debiterar byråns egen taxa (privat) får en rad per taxa när den
 * ändrats under ärendet.
 */
function arvodeRateRows(spec: InvoiceSpecification, fc: Fc): FakturaSummaryRow[] {
  return groupByKind(spec.timeLines).flatMap(({ kind, lines }) =>
    linesByRate(lines).map(([rateOre, ls]) => ({
      label: TIME_ENTRY_KIND_LABELS[kind], rateLabel: rateLabelFor(kind, rateOre, fc),
      hours: quantityLabel(kind, ls), amount: fc(sumOf(ls, (l) => l.amountOre)), subtotal: false,
    })));
}

/** Momssats i basis points → "25 %". Satsen kommer ur samma konstant som räknade momsen. */
const vatPercent = (bips: number): string => `${(bips / 100).toLocaleString("sv-SE")} %`;

const amountRow = (label: string, amount: string, subtotal: boolean): FakturaSummaryRow => ({ label, rateLabel: "", hours: "", amount, subtotal });

/**
 * Uträkningskedjan under arvoderaderna (#1200). Varje summarad = föregående
 * summarad + raderna mellan, så kedjan går att räkna efter:
 *   Summa arvode exkl moms (= arvoderaderna) → Moms på arvode → Utlägg exkl moms
 *   → Moms på utlägg → Äkta utlägg (utan moms) → [Summa inkl moms = slutsumman].
 * Momsbeloppen är spec:ens egna (inga omräkningar här). Äkta utlägg (#975) är
 * vidarefakturerade utan moms och ingår därför inte i momsunderlaget. Nollrader
 * utelämnas.
 */
function derivationRows(spec: InvoiceSpecification, fc: Fc): FakturaSummaryRow[] {
  const passThroughOre = spec.expenseLines.filter((l) => l.passThrough).reduce((s, l) => s + l.grossOre, 0);
  const rows: Array<[string, number]> = [
    [`Moms ${vatPercent(ARVODE_VAT_BIPS)} på arvode`, spec.arvodeVatOre],
    ["Utlägg exkl moms", spec.expensesNetOre - passThroughOre],
    [`Moms ${vatPercent(CHARGED_EXPENSE_VAT_RATE)} på utlägg`, spec.expensesVatOre],
    ["Äkta utlägg (utan moms)", passThroughOre],
  ];
  return [
    amountRow("Summa arvode exkl moms", fc(spec.arvodeNetOre), true),
    ...rows.filter(([, ore]) => ore !== 0).map(([label, ore]) => amountRow(label, fc(ore), false)),
  ];
}

const SUMMARY_TOTAL_LABEL = "Summa inkl moms";

/**
 * Sammanställningens rader (#925/#1200): arvoderaderna (exkl moms), följt av
 * uträkningskedjan. Slutsumman är det faktiska bruttot (arvode + moms + utlägg
 * + moms + äkta utlägg). Ett aconto har alltid enradsvarianten med fakturans
 * belopp (#1939), också när nedbrytningen bär tidsrader. Ren + testbar.
 */
function summarySection(a: FakturaTemplateArgs, spec: InvoiceSpecification | null, fc: Fc): Pick<FakturaView, "summary" | "summaryTotalLabel" | "summaryTotal"> {
  if (!spec || spec.timeLines.length === 0 || isAcconto(a.invoice)) {
    // Fakturor utan itemiserat arbete (rådgivningstimmen) och aconton får en
    // sammanställningsrad ur `notes` (#870) → beloppet är aldrig oförklarat.
    const label = a.invoice.notes?.trim() || "Arvode";
    return { summary: [amountRow(label, fc(a.invoice.amount), false)], summaryTotalLabel: SUMMARY_TOTAL_LABEL, summaryTotal: fc(a.invoice.amount) };
  }
  const summaOre = spec.arvodeNetOre + spec.arvodeVatOre + spec.expensesNetOre + spec.expensesVatOre;
  return { summary: [...arvodeRateRows(spec, fc), ...derivationRows(spec, fc)], summaryTotalLabel: SUMMARY_TOTAL_LABEL, summaryTotal: fc(summaOre) };
}

/** Itemiserad summering (#858) → uppdelningsrader. `deduct`=−, `info`=(parentes). */
function breakdownSplitRows(breakdown: FakturaBreakdown, fc: Fc): FakturaSplitRow[] {
  return breakdown.rows.map((r) => ({
    label: r.label,
    amount: r.kind === "deduct" ? `−${fc(r.amountOre)}` : r.kind === "info" ? `(${fc(r.amountOre)})` : fc(r.amountOre),
    style: r.kind === "deduct" ? "color:#b45309" : r.kind === "info" ? "color:#9ca3af" : "",
    muted: r.kind !== "add",
  }));
}

/** Spec-summeringen (#856) → uppdelningsrader: avdragna aconton + ev. justering. */
function specSplitRows(spec: InvoiceSpecification, fc: Fc): FakturaSplitRow[] {
  const rows: FakturaSplitRow[] = spec.deductions.map((d) => ({
    label: `Avgår aconto — faktura ${d.invoiceNumber}${d.date ? ` (${svDate(d.date)})` : ""}`,
    amount: `−${fc(d.amountOre)}`,
    style: "color:#b45309",
    muted: true,
  }));
  if (spec.adjustmentOre !== 0) {
    rows.push({
      label: spec.adjustmentOre < 0 ? "Nedsättning" : "Justering",
      amount: fc(spec.adjustmentOre), style: "color:#555", muted: true,
    });
  }
  return rows;
}

/**
 * Uppdelningen klient/betalare — EN lista oavsett källa (#938). Prioritet:
 * itemiserad nedbrytning (#858) → spec-summeringen (#856) → netto/moms ur
 * fakturan, med samma moms som verifikatet (`invoiceVatOre`, #1806).
 */
function splitRowsFor(a: FakturaTemplateArgs, spec: InvoiceSpecification | null, fc: Fc): FakturaSplitRow[] {
  if (a.breakdown) return breakdownSplitRows(a.breakdown, fc);
  if (spec) return specSplitRows(spec, fc);
  const vatOre = invoiceVatOre(a.invoice);
  return [
    { label: "Netto (exkl moms)", amount: fc(a.invoice.amount - vatOre), style: "", muted: false },
    { label: "Moms", amount: fc(vatOre), style: "", muted: false },
  ];
}

/** Faktura-huvudets fält (rubrik/nr/datum/mottagare/org). Utbrutet → håller
 *  `buildFakturaView` under param- och komplexitetsgränsen. */
function headerFields(a: FakturaTemplateArgs): Pick<FakturaView, "heading" | "footnote" | "invoiceNumber" | "ocr" | "date" | "matterNumber" | "matterTitle" | "recipient" | "organizationName" | "organizationOrgNumber" | "logo"> {
  const { invoice, meta } = a;
  return {
    heading: fakturaHeading(invoice),
    footnote: footnoteFor(invoice),
    invoiceNumber: invoice.invoiceNumber ?? "—",
    ocr: invoice.ocrReference ?? "",
    date: svDate(invoice.invoiceDate || new Date()),
    matterNumber: meta.matterNumber,
    matterTitle: meta.matterTitle,
    recipient: a.recipient,
    organizationName: meta.organizationName ?? "",
    organizationOrgNumber: meta.organizationOrgNumber ?? "",
    logo: meta.organizationLogo ?? null,
  };
}

/**
 * Bygg den färdigformaterade vy-modellen (#938) — enda stället där öre blir
 * text. PDF-renderaren (`renderFakturaPdf`) ritar den rakt av.
 */
export function buildFakturaView(a: FakturaTemplateArgs, fc: Fc = formatCurrency): FakturaView {
  const spec = resolveSpec(a);
  const showTimeAmounts = !isAcconto(a.invoice);
  return {
    ...headerFields(a),
    ...summarySection(a, spec, fc),
    // "Uppdelning klient / betalare"-rubriken (#925) visas bara när det finns en
    // faktisk split: en breakdown (självrisk/aconto/rättshjälpsavgift) ELLER
    // spec-avdrag/justering. Total-raden renderas alltid.
    hasSplit: !!a.breakdown || (!!spec && (spec.deductions.length > 0 || spec.adjustmentOre !== 0)),
    splitRows: splitRowsFor(a, spec, fc),
    totalLabel: a.breakdown?.totalLabel ?? "Att betala (inkl moms)",
    total: fc(a.breakdown ? a.breakdown.totalOre : a.invoice.amount),
    ...specTables(spec, fc, showTimeAmounts),
    showTimeAmounts,
    ...expenseTotals(spec, fc),
  };
}
