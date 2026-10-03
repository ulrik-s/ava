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
import { isPerDayKind, tidsspillanFtaxForDate, tidsspillanOvrigFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { CHARGED_EXPENSE_VAT_RATE } from "@/lib/shared/expense-vat";
import { ARVODE_VAT_BIPS } from "@/lib/shared/invoice-calc";
import { buildInvoiceSpecification, type InvoiceSpecification } from "@/lib/shared/invoice-specification";
import type { OrgImage } from "@/lib/shared/org-image";
import { TIME_ENTRY_KIND_LABELS, type AmountRounding, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import { roundingOf } from "@/lib/shared/whole-kronor";

export type { InvoiceSpecification };

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
  timeLines?: ReadonlyArray<{ date: string | Date; description: string; minutes: number; amountOre: number; kind?: TimeEntryKind | null | undefined }> | undefined;
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
  /** Momsbelopp (öre) i `amount`, exakt per sats (#782). Saknas → 25 %-split. */
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

/** En tidspost. Inget pris per post (#1439): posterna står under sin kategori,
 *  och kategorins timpris står i sammanställningen. */
export interface FakturaTimeRow { date: string; description: string; hours: string; amount: string }

/** Tidsspecifikationens deltabell för EN arvodeskategori (#1200) — rubrik,
 *  poster och delsumma ("Summa tidsspillan …: 3 tim — 4 461 kr"). */
export interface FakturaTimeGroup { label: string; lines: FakturaTimeRow[]; subtotalLabel: string; hours: string; amount: string }

export interface FakturaExpenseRow { date: string; description: string; net: string; gross: string }

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
  expenseLines: FakturaExpenseRow[];
}

const svDate = (d: Date | string | null | undefined): string => (d ? new Date(d).toLocaleDateString("sv-SE") : "");
const svHours = (minutes: number): string => (minutes / 60).toLocaleString("sv-SE", { maximumFractionDigits: 2 });

type Fc = (ore: number) => string;

/** Rubrik (h1 + `<title>` + demo-generatorns filnamn) per fakturatyp. */
export function fakturaHeading(inv: Pick<FakturaDocInvoice, "invoiceType" | "notes">): string {
  if (isRadgivning(inv)) return "Rådgivningsfaktura";
  if (inv.invoiceType === "CREDIT") return "Kreditfaktura";
  if (inv.invoiceType === "ACCONTO") return "Aconto-faktura";
  return "Faktura";
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

type CarriedWork = NonNullable<FakturaBreakdown["timeLines"]>;

/**
 * Specifikationens underlag (#937): fakturans EGNA länkade rader när de finns,
 * annars nedbrytningens upparbetade arbete (#880) — klientens självrisk-faktura
 * och aconton har inga egna tidsposter (arbetet bärs av betalar-fakturan), men
 * ska ändå redovisa vad beloppet bygger på. Ren funktion.
 */
function resolveSpec(a: FakturaTemplateArgs): InvoiceSpecification | null {
  const { spec, breakdown } = a;
  if (spec && spec.timeLines.length > 0) return spec;
  const carried = breakdown?.timeLines;
  if (!carried?.length) return spec ?? null;
  return specFromCarriedWork(carried, spec, a.invoice);
}

/** Bygg specifikationen ur nedbrytningens arbete, med spec:ens utlägg/avdrag kvar. */
function specFromCarriedWork(carried: CarriedWork, spec: InvoiceSpecification | null | undefined, invoice: FakturaDocInvoice): InvoiceSpecification {
  return buildInvoiceSpecification({
    timeLines: carried.map((l) => ({ date: l.date, description: l.description, minutes: l.minutes, amountOre: l.amountOre, kind: l.kind })),
    expenseLines: spec?.expenseLines ?? [],
    deductions: spec?.deductions ?? [],
    payableOre: invoice.amount,
    // Summeras med fakturans EGET avrundningssätt (#1438) — en äldre faktura
    // visar samma moms som när den skapades.
    rounding: roundingOf(invoice),
  });
}

type SpecLine = InvoiceSpecification["timeLines"][number];

/** Kategori-ordning i sammanställning och specifikation: arbete först, tidsspillan sist. */
const KIND_ORDER = Object.keys(TIME_ENTRY_KIND_LABELS) as TimeEntryKind[];

/**
 * Postens pris per enhet (öre, exkl moms): dagbeloppet för per-dygns-kategorier
 * (advokatberedskap har ingen timnorm, #950), annars timpriset ur belopp/minuter.
 */
function unitRateOre(l: SpecLine): number {
  if (isPerDayKind(l.kind)) return l.amountOre;
  return l.minutes > 0 ? Math.round((l.amountOre * 60) / l.minutes) : 0;
}

/**
 * Postens arvodeskategori (#925/#953). Bär raden sin ARVODESKATEGORI används
 * den — det är den enda uppgift som faktiskt avgör vilken norm posten ersätts på.
 * Att gissa ur timtaxan räcker inte: efter en retroaktiv höjning värderas posten
 * på slutregleringsårets norm men bär sitt eget datum, och två tidsspillan-normer
 * kan inte skiljas från arvodet på beloppet.
 *
 * Äldre fakturor (persisterade före #953) saknar kategorin. För dem räddas de två
 * tidsspillan-normerna ur taxan — resten är arvode.
 */
function resolveKind(l: SpecLine): TimeEntryKind {
  if (l.kind) return l.kind;
  const rateOre = unitRateOre(l);
  if (rateOre === tidsspillanFtaxForDate(l.date)) return "TIDSSPILLAN";
  if (rateOre === tidsspillanOvrigFtaxForDate(l.date)) return "TIDSSPILLAN_OVRIG_TID";
  return "ARBETE";
}

/** Tidsposterna per kategori, i KIND_ORDER; tomma kategorier utelämnas. */
function groupByKind(lines: readonly SpecLine[]): Array<{ kind: TimeEntryKind; lines: SpecLine[] }> {
  return KIND_ORDER
    .map((kind) => ({ kind, lines: lines.filter((l) => resolveKind(l) === kind) }))
    .filter((g) => g.lines.length > 0);
}

const sumOf = (lines: readonly SpecLine[], pick: (l: SpecLine) => number): number => lines.reduce((s, l) => s + pick(l), 0);

/** Omfattningen: timmar ("2,5") — eller antal dygn för per-dygns-kategorier. */
function quantityLabel(kind: TimeEntryKind, lines: readonly SpecLine[]): string {
  return isPerDayKind(kind) ? `${lines.length} dygn` : svHours(sumOf(lines, (l) => l.minutes));
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
 * + moms + äkta utlägg). Ren + testbar.
 */
function summarySection(a: FakturaTemplateArgs, spec: InvoiceSpecification | null, fc: Fc): Pick<FakturaView, "summary" | "summaryTotalLabel" | "summaryTotal"> {
  if (!spec || spec.timeLines.length === 0) {
    // Fakturor helt utan itemiserat arbete (rådgivningstimmen, rena aconton) får
    // ändå en sammanställningsrad ur `notes` (#870) → beloppet är aldrig oförklarat.
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
 * fakturan. Att vecka ihop grenarna här är det som gör att PDF:en och HTML:en
 * kan dela renderingslogik.
 */
function splitRowsFor(a: FakturaTemplateArgs, spec: InvoiceSpecification | null, fc: Fc): FakturaSplitRow[] {
  if (a.breakdown) return breakdownSplitRows(a.breakdown, fc);
  if (spec) return specSplitRows(spec, fc);
  const vatOre = a.invoice.vatOre ?? 0;
  return [
    { label: "Netto (exkl moms)", amount: fc(a.invoice.amount - vatOre), style: "", muted: false },
    { label: "Moms", amount: fc(vatOre), style: "", muted: false },
  ];
}

/** En tidspost i specifikationen — omfattning och belopp, inget pris (#1439). */
function timeRow(l: SpecLine, fc: Fc): FakturaTimeRow {
  return { date: svDate(l.date), description: l.description, hours: quantityLabel(resolveKind(l), [l]), amount: fc(l.amountOre) };
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** Tidsspecifikationen per arvodeskategori med delsumma (#1200). */
function timeGroups(spec: InvoiceSpecification, fc: Fc): FakturaTimeGroup[] {
  return groupByKind(spec.timeLines).map(({ kind, lines }) => ({
    label: TIME_ENTRY_KIND_LABELS[kind],
    lines: lines.map((l) => timeRow(l, fc)),
    subtotalLabel: `Summa ${lowerFirst(TIME_ENTRY_KIND_LABELS[kind])}`,
    hours: quantityLabel(kind, lines),
    amount: fc(sumOf(lines, (l) => l.amountOre)),
  }));
}

/** Specifikationens tabeller (tider + utlägg) ur den upplösta specifikationen. */
function specTables(spec: InvoiceSpecification | null, fc: Fc): Pick<FakturaView, "hasSpec" | "timeLines" | "timeGroups" | "expenseLines"> {
  if (!spec) return { hasSpec: false, timeLines: [], timeGroups: [], expenseLines: [] };
  return {
    hasSpec: spec.timeLines.length > 0 || spec.expenseLines.length > 0,
    timeLines: spec.timeLines.map((l) => timeRow(l, fc)),
    timeGroups: timeGroups(spec, fc),
    expenseLines: spec.expenseLines.map((l) => ({ date: svDate(l.date), description: l.description, net: fc(l.netOre), gross: fc(l.grossOre) })),
  };
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
    date: (invoice.invoiceDate ? new Date(invoice.invoiceDate) : new Date()).toLocaleDateString("sv-SE"),
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
    ...specTables(spec, fc),
  };
}
