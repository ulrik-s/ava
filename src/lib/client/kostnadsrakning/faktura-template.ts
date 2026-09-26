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
 *           tidsspillan …) med timpris och delsumma + utläggsspecifikation,
 *           dvs underlaget till beloppen på sida 1.
 *
 * `buildFakturaView` är den TYPADE vy-modellen (#938): färdigformaterade rader,
 * inga öre kvar. Både HTML-mallen (`renderFakturaHtml`) och PDF-bilagan
 * (`renderFakturaPdf`) läser den, så etiketter och belopp kan inte glida isär
 * mellan det dokument som arkiveras och det som mejlas.
 *
 * KOSTNADSRÄKNINGEN till domstol har en EGEN mall (`buildKostnadsrakningContext`)
 * — den är en myndighetsblankett, inte en faktura, och berörs inte här.
 */

import { formatCurrency } from "@/lib/client/utils";
import { isPerDayKind, tidsspillanFtaxForDate, tidsspillanOvrigFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { CHARGED_EXPENSE_VAT_RATE } from "@/lib/shared/expense-vat";
import { ARVODE_VAT_BIPS } from "@/lib/shared/invoice-calc";
import { buildInvoiceSpecification, type InvoiceSpecification } from "@/lib/shared/invoice-specification";
import { TIME_ENTRY_KIND_LABELS, type TimeEntryKind } from "@/lib/shared/schemas/enums";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import { renderHandlebars } from "./render-handlebars";

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

/** En tidspost. `rate` = timpriset ("1 500,00 kr/tim"), dagbeloppet för
 *  per-dygns-kategorier ("… kr/dygn"), tomt när det saknas (#1200). */
export interface FakturaTimeRow { date: string; description: string; hours: string; rate: string; amount: string }

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

/** Inbyggd faktura-mall (Handlebars) — används av template-motorn (#852) när
 *  ingen byrå-mall finns. HTML → öppningsbar + skrivbar. */
const FAKTURA_TEMPLATE = `<!DOCTYPE html><html lang="sv"><head><meta charset="utf-8"><title>{{heading}} {{invoiceNumber}}</title>
<style>@media print{.page-break{page-break-before:always}}.page-break{border:0;border-top:1px dashed #ccc;margin:2rem 0}</style></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;color:#111">
<h1 style="margin-bottom:0">{{heading}}</h1>
<p style="color:#555">Fakturanr: {{invoiceNumber}}{{#if ocr}} · OCR: {{ocr}}{{/if}}<br>Datum: {{date}}</p>
<p style="color:#555">Ärende {{matterNumber}} — {{matterTitle}}<br>Mottagare: {{recipient}}</p>

<h2 style="font-size:16px;margin-top:1.5rem;margin-bottom:.5rem">Sammanställning</h2>
{{#if summary.length}}
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px;margin-bottom:1rem">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Benämning</th><th style="text-align:right">Tim</th><th style="text-align:right">Timpris</th><th style="text-align:right">Belopp</th></tr></thead>
<tbody>{{#each summary}}<tr{{#if this.subtotal}} style="border-top:1px solid #ccc;font-weight:bold"{{/if}}><td>{{this.label}}</td><td style="text-align:right">{{this.hours}}</td><td style="text-align:right">{{this.rateLabel}}</td><td style="text-align:right">{{this.amount}}</td></tr>{{/each}}</tbody>
<tfoot><tr style="border-top:2px solid #333"><td style="font-weight:bold">{{summaryTotalLabel}}</td><td></td><td></td><td style="text-align:right;font-weight:bold">{{summaryTotal}}</td></tr></tfoot>
</table>{{/if}}
{{#if hasSplit}}<h3 style="font-size:14px;margin-top:1rem;margin-bottom:.25rem">Uppdelning klient / betalare</h3>{{/if}}
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:14px">
<tbody>{{#each splitRows}}<tr style="{{this.style}}"><td>{{this.label}}</td><td style="text-align:right;{{this.style}}">{{this.amount}}</td></tr>{{/each}}</tbody>
<tfoot><tr style="border-top:2px solid #333"><td style="font-weight:bold">{{totalLabel}}</td><td style="text-align:right;font-weight:bold">{{total}}</td></tr></tfoot>
</table>
{{#if footnote}}<p style="color:#555;font-size:13px;margin-top:1rem">{{footnote}}</p>{{/if}}
{{#if hasSpec}}
<hr class="page-break">
<h2 style="font-size:16px;margin-bottom:.25rem">Specifikation</h2>
<p style="color:#777;font-size:12px;margin-top:0">Underlag till beloppen i sammanställningen ovan.</p>
{{#if timeGroups.length}}
<h3 style="font-size:14px;margin-top:1rem;margin-bottom:.25rem">Tidsspecifikation</h3>
{{#each timeGroups}}
<h4 style="font-size:13px;margin-top:1rem;margin-bottom:.25rem">{{this.label}}</h4>
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Datum</th><th>Beskrivning</th><th style="text-align:right">Tim</th><th style="text-align:right">Timpris</th><th style="text-align:right">Belopp</th></tr></thead>
<tbody>{{#each this.lines}}<tr><td>{{this.date}}</td><td>{{this.description}}</td><td style="text-align:right">{{this.hours}}</td><td style="text-align:right;white-space:nowrap">{{this.rate}}</td><td style="text-align:right;white-space:nowrap">{{this.amount}}</td></tr>{{/each}}</tbody>
<tfoot><tr style="border-top:1px solid #ccc;font-weight:bold"><td colspan="2">{{this.subtotalLabel}}</td><td style="text-align:right">{{this.hours}}</td><td></td><td style="text-align:right;white-space:nowrap">{{this.amount}}</td></tr></tfoot>
</table>
{{/each}}{{/if}}
{{#if expenseLines.length}}
<h3 style="font-size:14px;margin-top:1.5rem;margin-bottom:.25rem">Utläggsspecifikation</h3>
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Datum</th><th>Beskrivning</th><th style="text-align:right">Netto</th><th style="text-align:right">Brutto</th></tr></thead>
<tbody>{{#each expenseLines}}<tr><td>{{this.date}}</td><td>{{this.description}}</td><td style="text-align:right">{{this.net}}</td><td style="text-align:right">{{this.gross}}</td></tr>{{/each}}</tbody>
</table>{{/if}}
{{/if}}
{{#if organizationName}}<p style="color:#777;font-size:13px;margin-top:1.5rem">{{organizationName}}{{#if organizationOrgNumber}} · {{organizationOrgNumber}}{{/if}}</p>{{/if}}
</body></html>`;

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
  return specFromCarriedWork(carried, spec, a.invoice.amount);
}

/** Bygg specifikationen ur nedbrytningens arbete, med spec:ens utlägg/avdrag kvar. */
function specFromCarriedWork(carried: CarriedWork, spec: InvoiceSpecification | null | undefined, payableOre: number): InvoiceSpecification {
  return buildInvoiceSpecification({
    timeLines: carried.map((l) => ({ date: l.date, description: l.description, minutes: l.minutes, amountOre: l.amountOre, kind: l.kind })),
    expenseLines: spec?.expenseLines ?? [],
    deductions: spec?.deductions ?? [],
    payableOre,
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

/** En tidspost i specifikationen, med sitt pris per enhet (#1200). */
function timeRow(l: SpecLine, fc: Fc): FakturaTimeRow {
  const kind = resolveKind(l);
  return { date: svDate(l.date), description: l.description, hours: quantityLabel(kind, [l]), rate: rateLabelFor(kind, unitRateOre(l), fc), amount: fc(l.amountOre) };
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
function headerFields(a: FakturaTemplateArgs): Pick<FakturaView, "heading" | "footnote" | "invoiceNumber" | "ocr" | "date" | "matterNumber" | "matterTitle" | "recipient" | "organizationName" | "organizationOrgNumber"> {
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
  };
}

/**
 * Bygg den färdigformaterade vy-modellen (#938) — enda stället där öre blir
 * text. HTML-mallen och PDF-bilagan renderar samma `FakturaView`.
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

/**
 * Rendera fakturan till HTML — sammanställning först, specifikation efter.
 * Enda vägen till faktura-HTML i hela kodbasen (appen + demo-generatorn, #937).
 */
export function renderFakturaHtml(args: FakturaTemplateArgs): string {
  return renderHandlebars(FAKTURA_TEMPLATE, { ...buildFakturaView(args, formatCurrency) });
}
