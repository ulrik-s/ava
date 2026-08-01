/**
 * Faktura-mallen — EN källa för ALLA fakturor (#937/#938).
 *
 * Upplägget är detsamma oavsett fakturatyp och betalningssätt:
 *   sida 1  Sammanställning — en rad per timtaxa (benämning + timtaxa + tim +
 *           belopp), utlägg exkl/inkl moms, summa, och därefter uppdelningen
 *           mellan klient och betalare (domstol/försäkringsbolag).
 *   sida 2+ Specifikation — tidsspecifikation + utläggsspecifikation, dvs
 *           underlaget till beloppen på sida 1.
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
import { tidsspillanFtaxForDate, timkostnadsnormFtaxForDate } from "@/lib/shared/brottmalstaxa";
import { buildInvoiceSpecification, type InvoiceSpecification } from "@/lib/shared/invoice-specification";
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
  timeLines?: ReadonlyArray<{ date: string | Date; description: string; minutes: number; amountOre: number }> | undefined;
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

/** En rad i sammanställningen: taxegrupp, utlägg eller moms. Tomma sträng-fält
 *  betyder "ingen kolumn-uppgift" (utlägg har ingen timtaxa). */
export interface FakturaSummaryRow { label: string; rateLabel: string; hours: string; amount: string }

/**
 * En rad i uppdelningen klient/betalare. `style` är en CSS-färg för HTML;
 * `muted` säger åt PDF:en att tona ned raden. `amount` bär redan sin dekoration
 * (−avdrag, (parentes) för info-rader) så båda renderarna skriver den rakt av.
 */
export interface FakturaSplitRow { label: string; amount: string; style: string; muted: boolean }

export interface FakturaTimeRow { date: string; description: string; hours: string; amount: string }
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
  summaryTotal: string;
  /** Visa rubriken "Uppdelning klient / betalare" (bara vid faktisk split). */
  hasSplit: boolean;
  splitRows: FakturaSplitRow[];
  totalLabel: string;
  total: string;
  /** Finns underlag att specificera → egen sida efter sammanställningen. */
  hasSpec: boolean;
  timeLines: FakturaTimeRow[];
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
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Benämning</th><th style="text-align:right">Timtaxa</th><th style="text-align:right">Tim</th><th style="text-align:right">Belopp</th></tr></thead>
<tbody>{{#each summary}}<tr><td>{{this.label}}</td><td style="text-align:right">{{this.rateLabel}}</td><td style="text-align:right">{{this.hours}}</td><td style="text-align:right">{{this.amount}}</td></tr>{{/each}}</tbody>
<tfoot><tr style="border-top:1px solid #ccc"><td style="font-weight:bold">Summa (inkl moms)</td><td></td><td></td><td style="text-align:right;font-weight:bold">{{summaryTotal}}</td></tr></tfoot>
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
{{#if timeLines.length}}
<h3 style="font-size:14px;margin-top:1rem;margin-bottom:.25rem">Tidsspecifikation</h3>
<table cellpadding="5" cellspacing="0" style="border-collapse:collapse;width:100%;font-size:13px">
<thead><tr style="border-bottom:1px solid #ccc;text-align:left"><th>Datum</th><th>Beskrivning</th><th style="text-align:right">Tim</th><th style="text-align:right">Belopp</th></tr></thead>
<tbody>{{#each timeLines}}<tr><td>{{this.date}}</td><td>{{this.description}}</td><td style="text-align:right">{{this.hours}}</td><td style="text-align:right">{{this.amount}}</td></tr>{{/each}}</tbody>
</table>{{/if}}
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
    timeLines: carried.map((l) => ({ date: l.date, description: l.description, minutes: l.minutes, amountOre: l.amountOre })),
    expenseLines: spec?.expenseLines ?? [],
    deductions: spec?.deductions ?? [],
    payableOre,
  });
}

/**
 * Benämning för en taxegrupp (#925): rättshjälpsärenden värderar arbete på
 * timkostnadsnormen och restid/väntetid på den lägre tidsspillan-normen — känns
 * igen genom att jämföra taxan mot ÅRETS normer (posten bär sitt datum, så
 * ärenden över ett årsskifte får rätt benämning per period). Övriga ärenden
 * debiterar byråns timtaxa → "Arvode".
 */
function rateGroupLabel(rateOre: number, date: Date | string): string {
  if (rateOre === tidsspillanFtaxForDate(date)) return "Tidsspillan";
  if (rateOre === timkostnadsnormFtaxForDate(date)) return "Arvode (timkostnadsnorm)";
  return "Arvode";
}

/** Gruppera arvodet på den härledda timtaxan → en rad per unik taxa (fallande). */
function arvodeRateRows(spec: InvoiceSpecification, fc: Fc): FakturaSummaryRow[] {
  const groups = new Map<number, { minutes: number; amountOre: number; date: Date | string }>();
  for (const l of spec.timeLines) {
    const rate = l.minutes > 0 ? Math.round((l.amountOre * 60) / l.minutes) : 0;
    const g = groups.get(rate) ?? { minutes: 0, amountOre: 0, date: l.date };
    groups.set(rate, { minutes: g.minutes + l.minutes, amountOre: g.amountOre + l.amountOre, date: g.date });
  }
  return [...groups.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, g]) => ({
      label: rateGroupLabel(rate, g.date),
      rateLabel: `${fc(rate)}/tim`,
      hours: svHours(g.minutes),
      amount: fc(g.amountOre),
    }));
}

/**
 * Sammanställningens rader (#925): en rad per timtaxa (arvode exkl moms), följt
 * av utlägg exkl moms → moms → utlägg inkl moms. Summan är det faktiska bruttot
 * (arvode inkl moms + utlägg inkl moms). Ren + testbar.
 */
function summarySection(a: FakturaTemplateArgs, spec: InvoiceSpecification | null, fc: Fc): { summary: FakturaSummaryRow[]; summaryTotal: string } {
  if (!spec || spec.timeLines.length === 0) {
    // Fakturor helt utan itemiserat arbete (rådgivningstimmen, rena aconton) får
    // ändå en sammanställningsrad ur `notes` (#870) → beloppet är aldrig oförklarat.
    const label = a.invoice.notes?.trim() || "Arvode";
    return { summary: [{ label, rateLabel: "", hours: "", amount: fc(a.invoice.amount) }], summaryTotal: fc(a.invoice.amount) };
  }
  const summary = arvodeRateRows(spec, fc);
  const hasExpenses = spec.expensesNetOre > 0 || spec.expensesVatOre > 0;
  // Ordning (#925): momsfritt utlägg → momsraden (total moms) → utlägg inkl moms
  // → summa (allt inkl moms). Momsraden är fakturans hela moms (arvode + utlägg),
  // så arvode-raderna (exkl moms) + utlägg exkl + moms = summan.
  if (hasExpenses) summary.push({ label: "Utlägg exkl moms", rateLabel: "", hours: "", amount: fc(spec.expensesNetOre) });
  summary.push({ label: "Moms", rateLabel: "", hours: "", amount: fc(spec.arvodeVatOre + spec.expensesVatOre) });
  if (hasExpenses) summary.push({ label: "Utlägg inkl moms", rateLabel: "", hours: "", amount: fc(spec.expensesNetOre + spec.expensesVatOre) });
  const summaOre = spec.arvodeNetOre + spec.arvodeVatOre + spec.expensesNetOre + spec.expensesVatOre;
  return { summary, summaryTotal: fc(summaOre) };
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

/** Specifikationens tabeller (tider + utlägg) ur den upplösta specifikationen. */
function specTables(spec: InvoiceSpecification | null, fc: Fc): Pick<FakturaView, "hasSpec" | "timeLines" | "expenseLines"> {
  if (!spec) return { hasSpec: false, timeLines: [], expenseLines: [] };
  return {
    hasSpec: spec.timeLines.length > 0 || spec.expenseLines.length > 0,
    timeLines: spec.timeLines.map((l) => ({ date: svDate(l.date), description: l.description, hours: svHours(l.minutes), amount: fc(l.amountOre) })),
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
