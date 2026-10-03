/**
 * `kostnadsrakning-document` — kostnadsräkningens DOKUMENT-vy (#1218).
 *
 * En vy-modell som både HTML-mallen och PDF-renderaren ritar ur, så att de två
 * aldrig kan visa olika saker. Layouten följer byråns egna kostnadsräkningar:
 *
 *   Sida 1 — brevhuvud, mottagare ("via e-post"), rubrik med målnummer,
 *            betalningsreferens, bankgiro, sammanställning (tre kolumner),
 *            summor, ev. rådgivningsnotis, ort + datum, underskrift, sidfot.
 *   Sida 2+ — ARBETSREDOGÖRELSE: ett avsnitt per kategori + utlägg.
 *
 * Betalningsreferensen är ÄRENDENUMRET: Domstolsverket betalar utan OCR och
 * återger referensen i fri text som "<ärendenr> <målnr> <advokat>" (#173/#175);
 * avprickningen matchar på ärende- eller målnumret.
 *
 * Ren funktion, inga side-effects. Beloppen avrundas inte här: dokumentet visar
 * yrkandet (`KrClaim`, avrundat till hela kronor per rad i `kr-claim.ts`), så
 * räkningen och det lagrade beloppet alltid är samma tal.
 */

import type { TaxaLevel, TaxaResult } from "./brottmalstaxa";
import { type Forhor, forhorMinutes, type ForordnandeResult, type TidsspillanUtover } from "./forordnandetaxa";
import { toIsoDate, toLocalTime, toSwedishLongDate } from "./iso-date";
import {
  expenseSpec, expenseSummaryRows, formatRow, hourlyRowSpecs, timeRowSpec, timeSpecSections,
  type KrExpenseLineLike, type KrExpenseSpec, type KrRowSpec, type KrSpecSection, type KrSummaryRow, type KrTimeLineLike,
} from "./kostnadsrakning-document-rows";
import type { KrClaim } from "./kr-claim";
import { formatHours, formatMinutes, formatOreAsKr } from "./kr-format";
import type { OrgImage } from "./org-image";

/** Byråns uppgifter som dokumentet visar (brevhuvud, sidfot, bankgiro, ort). */
export interface KrOrganization {
  name?: string | undefined;
  orgNumber?: string | undefined;
  address?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  bankgiro?: string | undefined;
  /** Ort för "{ort} den {datum}"; saknas → härleds ur adressens postort. */
  city?: string | undefined;
  /** Webbplats, t.ex. "https://www.exempel.se" — visas som "www.exempel.se". */
  website?: string | undefined;
  /** Logga överst på sida 1 (annars byråns namn). */
  logo?: OrgImage | undefined;
  /** Märke till vänster i sidfoten (t.ex. ledamot av advokatsamfundet). */
  footerSeal?: OrgImage | undefined;
}

/** Huvudförhandlingen (0 min = ingen). `amountOre` = dess värde vid löpande räkning. */
export interface KrHuvudforhandling {
  start: Date;
  end: Date;
  minutes: number;
  rateOrePerH: number;
  amountOre: number;
}

/** Vad arvodet står på — styr sammanställningens arvodesrader och noter. */
export type KrArvodeBasis =
  | { kind: "lopande"; notes: readonly string[] }
  | { kind: "brottmalstaxa"; level: TaxaLevel; taxa: TaxaResult; tidsspillan: TidsspillanUtover }
  | { kind: "forordnande"; ford: Extract<ForordnandeResult, { kind: "taxa" }> };

/** Indata till dokumentvyn. */
export interface KrDocumentInput {
  matterNumber: string;
  courtCaseNumber?: string | undefined;
  courtName?: string | undefined;
  defenderName: string;
  defenderTitle?: string | undefined;
  organization: KrOrganization;
  hasFTax: boolean;
  yrkandeDate: Date;
  basis: KrArvodeBasis;
  huf: KrHuvudforhandling;
  timeLines: readonly KrTimeLineLike[];
  forhor?: readonly Forhor[] | undefined;
  expenseLines: readonly KrExpenseLineLike[];
  /** Det yrkade beloppet (avrundat) — raderna i samma ordning som `krArvodePart`. */
  claim: KrClaim;
  radgivningNotice: string | null;
}

/** Kostnadsräkningens dokumentvy — allt färdigformaterat. */
/**
 * Skiljetecknet mellan sidfotens delar. Mittpunkten finns i WinAnsi, som PDF:ens
 * standardteckensnitt kodar — det tidigare "∽" saknades där och ritades som en
 * vektor som såg ut som ett trasigt tecken.
 */
export const FOOTER_SEPARATOR = " · ";

export interface KrDocumentView {
  /** Brevhuvudet (byråns namn centrerat överst); tom = inget brevhuvud. */
  firmName: string;
  /** Loggan i brevhuvudet — ersätter namnet när den finns. */
  logo: OrgImage | null;
  /** Märket till vänster i sidfoten på sida 1. */
  footerSeal: OrgImage | null;
  /** Sidfotens rader på sida 1; varje rad är delar som sammanfogas med `FOOTER_SEPARATOR`. */
  footerLines: string[][];
  /** Mottagaren (domstolen); null = inget mottagarblock. */
  recipient: string | null;
  title: string;
  /** Betalningsreferensen (ärendenumret) — "Anges vid betalning". */
  paymentReference: string;
  bankgiro: string | null;
  summaryRows: KrSummaryRow[];
  /** Noter under sammanställningen (taxa, varningar). */
  notes: string[];
  totals: { exclVat: string; vatLabel: string; vat: string; inclVat: string };
  radgivningNotice: string | null;
  /** "Lund den 24 september 2026" (eller bara datumet utan känd ort). */
  placeDate: string;
  signatureName: string;
  signatureTitle: string | null;
  specSections: KrSpecSection[];
  expenseSpec: KrExpenseSpec | null;
  /** Finns det något att redovisa på sida 2+? */
  hasSpecification: boolean;
}

const nonEmpty = (s: string | undefined): s is string => s !== undefined && s.trim() !== "";

/** Svenskt momsregistreringsnummer för en juridisk person: SE + orgnr (10 siffror) + 01. */
export function vatNumberFromOrgNumber(orgNumber: string | undefined): string | undefined {
  const digits = (orgNumber ?? "").replace(/\D/g, "");
  return digits.length === 10 ? `SE${digits}01` : undefined;
}

function capitalize(word: string): string {
  return word === word.toUpperCase() ? word.charAt(0) + word.slice(1).toLowerCase() : word;
}

/** Postorten ur en svensk adress ("Storgatan 1, 222 22 LUND" → "Lund"). */
export function cityFromAddress(address: string | undefined): string | undefined {
  const m = /\d{3}\s?\d{2}\s+([^\d,\n]+)$/.exec((address ?? "").trim());
  const city = m?.[1]?.trim();
  return city ? city.split(/\s+/).map(capitalize).join(" ") : undefined;
}

/** "https://www.exempel.se/" → "www.exempel.se" (sidfotens form). */
export function displayWebsite(url: string | undefined): string | undefined {
  const bare = (url ?? "").trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return bare === "" ? undefined : bare;
}

function footerLines(org: KrOrganization, hasFTax: boolean): string[][] {
  const lines = [
    [org.name],
    [org.phone ? `Tel: ${org.phone}` : undefined, displayWebsite(org.website), org.email],
    [
      org.bankgiro ? `Arvoden bankgiro ${org.bankgiro}` : undefined,
      vatNumberFromOrgNumber(org.orgNumber) ? `VAT nr: ${vatNumberFromOrgNumber(org.orgNumber)}` : undefined,
      hasFTax ? "Godkänd för F-skatt" : undefined,
    ],
  ];
  return lines.map((parts) => parts.filter(nonEmpty)).filter((parts) => parts.length > 0);
}

function placeDate(org: KrOrganization, date: Date): string {
  const city = nonEmpty(org.city) ? org.city.trim() : cityFromAddress(org.address);
  return city ? `${city} den ${toSwedishLongDate(date)}` : toSwedishLongDate(date);
}

function title(courtCaseNumber: string | undefined): string {
  return nonEmpty(courtCaseNumber) ? `KOSTNADSRÄKNING i mål ${courtCaseNumber.trim()}` : "KOSTNADSRÄKNING";
}

// ─── Arvodet: sammanställningsrader + noter per grund ──────────────────────

/** Tidsspillan utöver den timme som ingår i taxan (DVFS 2025:6 6 §, 2025:5 8 §). */
function tidsspillanUtoverRows(ts: TidsspillanUtover): KrRowSpec[] {
  const rows: KrRowSpec[] = [];
  if (ts.extraVardagMinutes > 0) rows.push(timeRowSpec("TIDSSPILLAN UTÖVER TAXAN", ts.extraVardagMinutes, ts.vardagRateOre));
  if (ts.extraOvrigMinutes > 0) rows.push(timeRowSpec("TIDSSPILLAN ANNAN TID UTÖVER TAXAN", ts.extraOvrigMinutes, ts.ovrigRateOre));
  return rows;
}

/**
 * Taxan (allt arbete, 5 §) + tidsspillan utöver den timme som ingår (6 §, #1182)
 * + advokatberedskapen per dygn, som ligger utanför taxan (#1024). Över taxans
 * maxgräns yrkas ingenting här — räkningen ska då göras löpande (8 §).
 */
function brottmalRows(basis: Extract<KrArvodeBasis, { kind: "brottmalstaxa" }>, huf: KrHuvudforhandling, lines: readonly KrTimeLineLike[]): KrRowSpec[] {
  if (basis.taxa.kind !== "taxa-applies") return [];
  const beredskap = lines.filter((l) => l.kind === "ADVOKATBEREDSKAP" && l.amountOre > 0);
  return [
    { label: "ARVODE ENLIGT BROTTMÅLSTAXAN", quantity: `${formatHours(huf.minutes)} tim`, amountOre: basis.taxa.ersattningExclVat },
    ...tidsspillanUtoverRows(basis.tidsspillan),
    ...hourlyRowSpecs(beredskap),
  ];
}

function brottmalNotes(basis: Extract<KrArvodeBasis, { kind: "brottmalstaxa" }>, huf: KrHuvudforhandling): string[] {
  const hufText = `Huvudförhandling ${toIsoDate(huf.start)} kl. ${toLocalTime(huf.start)}–${toLocalTime(huf.end)}.`;
  if (basis.taxa.kind !== "taxa-applies") {
    return [hufText, "Förhandlingstiden överstiger taxans maxgräns (3 tim 45 min). Ersättning beräknas enligt timkostnadsnorm × faktisk tid (DVFS 2025:6 § 8)."];
  }
  return [hufText, `Brottmålstaxa (DVFS 2025:6), nivå ${basis.level}, intervall ${basis.taxa.intervalLabel}.`];
}

type ForordnandeTaxa = Extract<ForordnandeResult, { kind: "taxa" }>;

function forordnandeRows(ford: ForordnandeTaxa): KrRowSpec[] {
  return [
    { label: "ARVODE ENLIGT TAXA I FÖRORDNANDEMÅL", quantity: `${formatHours(ford.forhorMinutes)} tim`, amountOre: ford.taxa.ersattningExclVat },
    ...tidsspillanUtoverRows(ford.tidsspillan),
  ];
}

function forordnandeNotes(ford: ForordnandeTaxa): string[] {
  const ts = ford.tidsspillan;
  const total = ts.ingarOvrigMinutes + ts.ingarVardagMinutes + ts.extraOvrigMinutes + ts.extraVardagMinutes;
  const notes = [
    `Förundersökningen har avslutats utan åtal — förordnandemål (DVFS 2025:5). Taxa, förhörstid ${ford.taxa.intervalLabel}.`,
    `Tidsspillan totalt ${formatMinutes(total)}, varav ${formatMinutes(ts.ingarOvrigMinutes + ts.ingarVardagMinutes)} ingår i taxan.`,
  ];
  if (ford.gransvardeOverskrids) notes.push("Arbetet överstiger taxans gränsvärde — taxan får frångås (10 §). Överväg löpande räkning.");
  return notes;
}

/** HUF som en tidsrad (arbete) — ingår i arvodet vid löpande räkning. */
function hufLine(huf: KrHuvudforhandling): KrTimeLineLike[] {
  if (huf.minutes <= 0) return [];
  return [{
    date: toIsoDate(huf.start),
    description: `Huvudförhandling kl. ${toLocalTime(huf.start)}–${toLocalTime(huf.end)}`,
    minutes: huf.minutes, kind: "ARBETE", rateOrePerH: huf.rateOrePerH, amountOre: huf.amountOre,
  }];
}

/** Arvodets rader (oavrundade), noter och redogörelsens rubriktillägg. */
export interface KrArvodePart { rows: KrRowSpec[]; notes: string[]; specSuffix: string; lines: KrTimeLineLike[] }

/** Arvodesdelen per grund — raderna är underlaget för yrkandet (`krClaim`). */
export function krArvodePart(basis: KrArvodeBasis, huf: KrHuvudforhandling, timeLines: readonly KrTimeLineLike[]): KrArvodePart {
  const lines = [...hufLine(huf), ...timeLines];
  switch (basis.kind) {
    case "lopande": return { rows: hourlyRowSpecs(lines), notes: [...basis.notes], specSuffix: "", lines };
    case "brottmalstaxa": return { rows: brottmalRows(basis, huf, lines), notes: brottmalNotes(basis, huf), specSuffix: " (ingår i taxan)", lines };
    case "forordnande": return { rows: forordnandeRows(basis.ford), notes: forordnandeNotes(basis.ford), specSuffix: " (ingår i taxan)", lines };
    default: { const never: never = basis; return never; }
  }
}

// ─── Arbetsredogörelsen ────────────────────────────────────────────────────

function forhorSection(forhor: readonly Forhor[] | undefined): KrSpecSection[] {
  if (!forhor || forhor.length === 0) return [];
  return [{
    heading: "Förhör under förundersökningen",
    rows: forhor.map((f) => ({ date: toIsoDate(f.start), description: `Förhör kl. ${toLocalTime(f.start)}–${toLocalTime(f.end)}`, quantity: formatHours(forhorMinutes(f)) })),
    sum: formatHours(forhor.reduce((s, f) => s + forhorMinutes(f), 0)),
  }];
}

/** "Moms (25%)" — utom när äkta utlägg (0 %) ingår, då är momsen inte 25 % av summan. */
function vatLabel(expenseLines: readonly KrExpenseLineLike[]): string {
  return expenseLines.every((l) => l.vatRate === 2500) ? "Moms (25%)" : "Moms";
}

function summaryRows(part: KrArvodePart, input: KrDocumentInput): KrSummaryRow[] {
  const arvode = part.rows.map((r, i) => formatRow(r, input.claim.arvodeRowsOre[i] ?? r.amountOre));
  return [...arvode, ...expenseSummaryRows(input.expenseLines, input.claim.expenseExclVat)];
}

/** Trimmad text, eller null när den saknas. */
const textOrNull = (s: string | undefined): string | null => (nonEmpty(s) ? s.trim() : null);

/** Brevhuvud, mottagare, rubrik och bankgiro — sidans huvud. */
function headerOf(input: KrDocumentInput): Pick<KrDocumentView, "firmName" | "logo" | "footerSeal" | "recipient" | "title" | "paymentReference" | "bankgiro"> {
  const org = input.organization;
  return {
    firmName: textOrNull(org.name) ?? "",
    logo: org.logo ?? null,
    footerSeal: org.footerSeal ?? null,
    recipient: textOrNull(input.courtName),
    title: title(input.courtCaseNumber),
    paymentReference: input.matterNumber,
    bankgiro: textOrNull(org.bankgiro),
  };
}

/** Bygg kostnadsräkningens dokumentvy. */
export function buildKrDocument(input: KrDocumentInput): KrDocumentView {
  const org = input.organization;
  const arvode = krArvodePart(input.basis, input.huf, input.timeLines);
  const expenseExcl = input.expenseLines.reduce((s, l) => s + l.exclVat, 0);
  const specSections = [...forhorSection(input.forhor), ...timeSpecSections(arvode.lines, arvode.specSuffix)];
  const spec = expenseSpec(input.expenseLines, expenseExcl);
  const claim = input.claim;
  return {
    ...headerOf(input),
    footerLines: footerLines(org, input.hasFTax),
    summaryRows: summaryRows(arvode, input),
    notes: arvode.notes,
    totals: { exclVat: formatOreAsKr(claim.exclVat), vatLabel: vatLabel(input.expenseLines), vat: formatOreAsKr(claim.vat), inclVat: formatOreAsKr(claim.inclVat) },
    radgivningNotice: input.radgivningNotice,
    placeDate: placeDate(org, input.yrkandeDate),
    signatureName: input.defenderName,
    signatureTitle: textOrNull(input.defenderTitle),
    specSections,
    expenseSpec: spec,
    hasSpecification: specSections.length > 0 || spec !== null,
  };
}
