/**
 * `SettlementView` (#876) — den persisterade slutregleringsvyn. EN källa för
 * BÅDE faktura-dokumentet (generateFakturaFromTemplate) och Slutfaktura-sidan
 * (`/invoices/[id]`), så de aldrig glider isär. Byggs server-side i settleCoverage
 * ur `SettlementBreakdown` och sparas på respektive faktura (`settlementBreakdown`
 * jsonb). Rena display-siffror i öre — ändrar inga belopp.
 */

import { accontoCreditAmounts, accontoCreditLines, accontoSplit } from "./acconto-vat";
import type { VatBreakdownLine } from "./accounting/semantic-voucher";
import { vatOnNet, type UnfrozenWork } from "./billing-work-value";
import { coverageEntryValueOre, payableCoverageEntries } from "./brottmalstaxa";
import type { RattsskyddClientParts } from "./coverage-billing";
import { arvodeInclVatOre } from "./invoice-calc";
import type { SpecDeduction, SpecTimeLine } from "./invoice-specification";
import { radgivningTextRad } from "./rattshjalp";
import type { PaymentMethod, TimeEntryKind } from "./schemas/enums";

/** `add` = delbelopp/steg i trappan, `deduct` = avgår (−), `info` = spårbarhets-
 *  rad utan beloppspåverkan (visas i parentes/grått, t.ex. rådgivnings-omnämnandet). */
export type SettlementRowKind = "add" | "deduct" | "info";

export interface SettlementRow {
  label: string;
  amountOre: number;
  kind: SettlementRowKind;
}

/** En rad i tidsspecifikations-tabellen (arbetad tid). */
export interface SettlementViewLine {
  date: string;
  description: string;
  minutes: number;
  amountOre: number;
  /** Arvodeskategori (#953) — sammanställningen benämner taxeraderna på den, så
   *  klientens faktura skiljer arbete från tidsspillan. Saknas på äldre vyer. */
  kind?: TimeEntryKind | null | undefined;
}

export interface SettlementView {
  /** Tidsspec-tabellen (arbetad tid). Tom → ingen tabell renderas. */
  timeLines: SettlementViewLine[];
  /** Nedbrytningsraderna (beloppstrappan). */
  rows: SettlementRow[];
  /** Etikett på total-raden ("Att betala (inkl moms)" / "DOMSTOL — att betala …"). */
  totalLabel: string;
  totalOre: number;
}

// ─── Byggarna (#1100) ───────────────────────────────────────────────────────
//
// Låg i `routers/billingRun.ts` fram till #1100. Doc-kommentaren överst säger
// att vyn "byggs server-side i settleCoverage" — men BYGGANDET är ren
// presentation: siffror som redan är uträknade radas upp i den ordning en
// jurist läser dem. Inget av det rör nätet, databasen eller behörigheter, och
// nu bor byggaren hos typen den bygger.
//
// Allt som tar `repos` — `buildSettlementBreakdown`, som HÄMTAR underlaget —
// stannar i routern. Gränsen syns i importlistan: den här filen importerar
// bara från `./`, aldrig från `@/lib/server/*`.

/**
 * Slutregleringens itemiserade nedbrytning (#858) — så BÅDE domstols- och
 * klientfakturan blir självförklarande. Rena display-siffror (brutto, öre); ÄNDRAR
 * inga belopp (klient = självrisk − aconton, domstol = statens andel, oförändrat):
 *   - domstolsfakturan bryter ned "Nedsättning" i självrisk/rådgivning/prutning,
 *   - klientfakturan visar självrisk-uträkningen (andel × upparbetat),
 *   - avdragna aconton listas (avräknas EN gång, på klientfakturan; info på domstol).
 */
export interface SettlementBreakdown {
  clientShareBips: number;
  arvodeBaseNetOre: number;      // bas-arvode (exkl rådgivning), netto — "andel × X"
  baseArvodeGrossOre: number;    // bas-arvode (exkl rådgivning), brutto — domstolens arvode-rad
  expensesGrossOre: number;      // utlägg brutto — BETALARENS andel (#878)
  clientExpensesGrossOre: number; // utlägg brutto — KLIENTENS andel (#878)
  // #947: utläggen ingår i BASEN som prutas och delas → trappan behöver dem netto.
  expensesBaseNetOre: number;    // utlägg netto FÖRE nedsättning
  expenseLossNetOre: number;     // nedsättningens utläggsdel (byrån bär)
  clientExpensesNetOre: number;  // klientens utläggsandel netto
  clientExpensesVatOre: number;  // …och dess moms (klientens riktiga satser)
  payerExpensesNetOre: number;   // betalarens utläggsandel netto
  payerExpensesVatOre: number;   // …och dess moms (25 % mot domstol, #945)
  sjalvriskNetOre: number;       // klientens självrisk NETTO (andel × arvodeBaseNet) — moms-trappan (#876)
  sjalvriskGrossOre: number;     // klientens självrisk brutto
  firmLossNetOre: number;        // byrå-förlust/prutning NETTO — domstolens trappa (#876)
  prutningGrossOre: number;      // byrå-förlust/prutning brutto
  payerArvodeNetOre: number;     // domstolens/försäkringens andel av arvodet NETTO — trappan (#876)
  radgivningGrossOre: number;    // redan fakturerad rådgivningstimme brutto — bara omnämnd, ej i underlaget (#876/#1205)
  radgivningNetOre: number;      // samma timme NETTO — info-raden i arvodestrappan (#1205)
  payerPayableOre: number;       // domstolen att betala
  clientPayableOre: number;      // klienten att betala (självrisk − aconton)
  // Klientens självrisk-faktura specificeras med den arbetade tiden (#876). Raderna
  // är avstämda så summan = arvodeBaseNetOre (låsta poster, t.ex. rådgivningen, ingår ej).
  clientArvodeLines: SpecTimeLine[];
  deductedAccontos: SpecDeduction[];
  /** Rättsskydd: varför klientens del blev som den blev (#935) — otäckt arbete,
   *  självrisk, bolagets prutning, belopp över taket. Utelämnad för övriga metoder. */
  clientParts?: RattsskyddClientParts;
}

/** Klientfakturans tidsspec (#876): det ofrysta arbetet, värderat på samma rate
 *  som arvodesbasen och AVSTÄMT så radernas summa exakt = `totalArvodeNet` (per-
 *  rad-avrundning läggs på sista raden). Rådgivningstimmen är en låst post och
 *  finns inte i `work` (#1205) — ingen registrerad tid dras av i dess ställe. */
export function buildClientArvodeLines(work: UnfrozenWork, totalArvodeNet: number, settleDate: Date | string): SpecTimeLine[] {
  const entries = payableCoverageEntries(work.timeEntries.filter((t) => t.billable));
  // #891/#950: varje rad värderas på sin KATEGORIS norm för slutregleringsåret —
  // för alla betalningssätt, så raderna summerar till `totalArvodeNet`. Per-dygns-
  // kategorier (advokatberedskap) får sitt dagbelopp, inte minuter × norm.
  const lines: SpecTimeLine[] = entries.map((t) => ({
    date: t.date, description: t.description, minutes: t.minutes, kind: t.kind,
    amountOre: coverageEntryValueOre(t, settleDate),
  }));
  const sum = lines.reduce((s, l) => s + l.amountOre, 0);
  const last = lines[lines.length - 1];
  if (last && sum !== totalArvodeNet) last.amountOre += totalArvodeNet - sum; // avstämning (öre)
  return lines;
}

/** Den redan fakturerade rådgivningstimmen (1 h, rättshjälp) — omnämns på
 *  fakturorna men ingår ALDRIG i underlaget (#1205). 0 när ingen rådgivnings-
 *  faktura finns (icke-rättshjälp, eller rättshjälp utan registrerad rådgivning). */
export function radgivningOre(radgivningInvoiced: boolean, rateOre: number): { radgivningGrossOre: number; radgivningNetOre: number } {
  if (!radgivningInvoiced) return { radgivningGrossOre: 0, radgivningNetOre: 0 };
  return { radgivningGrossOre: arvodeInclVatOre(rateOre), radgivningNetOre: rateOre };
}

export const svd = (d: Date | string | null | undefined): string => (d ? new Date(d).toLocaleDateString("sv-SE") : "");
export const toViewLine = (l: SpecTimeLine): SettlementViewLine => ({
  date: new Date(l.date).toISOString().slice(0, 10), description: l.description, minutes: l.minutes,
  amountOre: l.amountOre, kind: l.kind,
});

/**
 * Persisterad slutregleringsvy (#876) — EN källa för både faktura-dokumentet och
 * Slutfaktura-sidan. Byggdes tidigare i `_settlement-dialog.tsx`; flyttad hit så
 * servern äger raderna och sparar dem på fakturan (`settlementBreakdown`).
 *
 * KLIENT (rättshjälpsavgift/självrisk): tidsspec + moms-trappa (netto → andel →
 * moms → inkl) + klientens utläggsandel (#878). `feeTerm` = "rättshjälpsavgift"
 * (rättshjälp) eller "självrisk" (rättsskydd).
 */
/**
 * Rättsskyddets fyra klient-poster → rader (#935), i den ordning de uppstår:
 * otäckt arbete → självrisk på täckt del → bolagets prutning → över taket.
 * Nollposter utelämnas. Summan = klientens netto (invariant, testad i
 * `coverage-billing.test.ts`).
 */
export function rattsskyddClientRows(p: RattsskyddClientParts, share: string): SettlementRow[] {
  const rows: SettlementRow[] = [];
  if (p.uncoveredOre > 0) rows.push({ label: "Arbete utanför försäkringens täckning — klienten betalar 100 % (exkl moms)", amountOre: p.uncoveredOre, kind: "add" });
  if (p.sjalvriskOre > 0) rows.push({ label: `Självrisk ${share} % av täckt arbete (exkl moms)`, amountOre: p.sjalvriskOre, kind: "add" });
  if (p.prutningOre > 0) rows.push({ label: "Försäkringens prutning — klienten bär (exkl moms)", amountOre: p.prutningOre, kind: "add" });
  if (p.overCapOre > 0) rows.push({ label: "Belopp över försäkringens maxbelopp (exkl moms)", amountOre: p.overCapOre, kind: "add" });
  return rows;
}

export const shareLabel = (bips: number): string => (bips / 100).toLocaleString("sv-SE", { maximumFractionDigits: 2 });

/**
 * Arvodestrappan ned till det BEVILJADE beloppet (#941) — samma på klientens och
 * betalarens faktura, och i den ordning beräkningen faktiskt sker:
 *   1. domstolens prutning (byrån bär den),
 *   2. först då är basen för klientens rättshjälpsavgift klar.
 * Rådgivningstimmen ingår inte i underlaget (#1205) — den är redan fakturerad
 * klienten och omnämns bara som info-rad. Mellanstegen renderas bara när de har
 * ett belopp, så rättsskydd (ingen byrå-buren prutning) får en enda rad.
 */
export function arvodeLadderRows(b: SettlementBreakdown, payerNoun: string): SettlementRow[] {
  const rows: SettlementRow[] = [
    { label: "Upparbetat arvode (exkl moms)", amountOre: b.arvodeBaseNetOre, kind: "add" },
  ];
  // Utläggen tillhör BASEN — de prutas och delas precis som arvodet (#947), så de
  // hör hemma ovanför avdragen och inte som en lös rad längst ned.
  if (b.expensesBaseNetOre > 0) {
    rows.push({ label: "Utlägg (exkl moms)", amountOre: b.expensesBaseNetOre, kind: "add" });
    rows.push({ label: "Underlag (exkl moms)", amountOre: ladderBaseOre(b), kind: "add" });
  }
  const prutningOre = totalPrutningNetOre(b);
  if (prutningOre > 0) {
    rows.push({ label: `Avgår ${payerNoun.toLowerCase()} prutning — byrån bär (exkl moms)`, amountOre: prutningOre, kind: "deduct" });
    rows.push({ label: "Beviljat belopp (exkl moms)", amountOre: awardedBaseOre(b), kind: "add" });
  }
  if (b.radgivningNetOre > 0) {
    rows.push({ label: radgivningTextRad("faktura"), amountOre: b.radgivningNetOre, kind: "info" });
  }
  return rows;
}

/** Basen trappan utgår från: allt upparbetat arvode + utlägg, netto. */
export function ladderBaseOre(b: SettlementBreakdown): number {
  return b.arvodeBaseNetOre + b.expensesBaseNetOre;
}

/** Hela nedsättningen byrån bär — arvodets del OCH utläggens (#943). */
export function totalPrutningNetOre(b: SettlementBreakdown): number {
  return b.firmLossNetOre + b.expenseLossNetOre;
}

/** Det beviljade beloppet klientens andel räknas på: bas − prutning. */
export function awardedBaseOre(b: SettlementBreakdown): number {
  return ladderBaseOre(b) - totalPrutningNetOre(b);
}

/** Klientens andel räknas på det BEVILJADE beloppet när domstolen prutat (#941)
 *  — säg det i etiketten, annars går procenten inte att stämma av mot raden ovan. */
export function feeBaseSuffix(b: SettlementBreakdown): string {
  return totalPrutningNetOre(b) > 0 ? " av beviljat belopp" : "";
}

/**
 * Momsradens etikett (#947): "Moms 25 %" bara när hela underlaget faktiskt bär
 * 25 %. Klientens utlägg kan ha 0/6/12 %, och då är en 25 %-etikett direkt
 * felaktig — säg bara "Moms".
 */
export function vatLabel(netOre: number, vatOre: number): string {
  return netOre > 0 && vatOre === vatOnNet(netOre) ? "Moms 25 %" : "Moms";
}

/**
 * Momsraden på klientfakturan, med ev. aconto-avdrag (#968).
 *
 * UTAN aconton: oförändrad ordning — moms, sedan inkl-moms-raden.
 *
 * MED aconton: avdragen läggs NETTO och FÖRE momsraden, som då bara visar momsen
 * på det som återstår. Acontofakturorna har redan fakturerat sin egen moms;
 * dokumentet får inte redovisa den en gång till. Förr låg avdragen brutto EFTER
 * momsraden, så fakturan visade momsen på hela självrisken — 3 704,61 kr på ett
 * belopp om 9 273,31 kr. Inkl-moms-raden utgår i det läget: den skulle peka på en
 * summa som ingen ska betala.
 */
export function clientVatRows(b: SettlementBreakdown, feeCap: string): SettlementRow[] {
  const netOre = b.sjalvriskNetOre + b.clientExpensesNetOre;
  const fullVatOre = b.sjalvriskGrossOre - b.sjalvriskNetOre + b.clientExpensesVatOre;
  if (b.deductedAccontos.length === 0) {
    return [
      { label: vatLabel(netOre, fullVatOre), amountOre: fullVatOre, kind: "add" },
      { label: `${feeCap} inkl utlägg (inkl moms)`, amountOre: b.sjalvriskGrossOre + b.clientExpensesGrossOre, kind: "add" },
    ];
  }
  const rows: SettlementRow[] = [];
  let restVatOre = fullVatOre;
  for (const d of b.deductedAccontos) {
    const { netOre: accNet, vatOre: accVat } = accontoSplit(d.amountOre);
    restVatOre -= accVat;
    const when = d.date ? ` (${svd(d.date)})` : "";
    rows.push({ label: `Avgår aconto — faktura ${d.invoiceNumber}${when}, exkl moms`, amountOre: accNet, kind: "deduct" });
  }
  rows.push({ label: "Moms på återstående belopp", amountOre: restVatOre, kind: "add" });
  return rows;
}

export function buildClientView(b: SettlementBreakdown, isRattshjalp: boolean, feeTerm: string): SettlementView {
  const share = shareLabel(b.clientShareBips);
  const feeCap = feeTerm.charAt(0).toUpperCase() + feeTerm.slice(1);
  const rows: SettlementRow[] = arvodeLadderRows(b, isRattshjalp ? "Domstolens" : "Försäkringens");
  // Rättsskydd (#935): klientens del är summan av FYRA poster — särredovisa dem i
  // stället för ett lumpet belopp, så klienten ser varför den ska betala. Rättshjälp
  // har bara avgiftsandelen (prutningen bärs av byrån, inte klienten).
  if (!isRattshjalp && b.clientParts) {
    rows.push(...rattsskyddClientRows(b.clientParts, share));
    if (b.clientExpensesNetOre > 0) rows.push({ label: "Klientens andel av utläggen (exkl moms)", amountOre: b.clientExpensesNetOre, kind: "add" });
  } else {
    // Andelen omfattar BÅDE arvode och utlägg (#947) — de delas i samma proportion.
    rows.push({ label: `Klientens ${feeTerm} ${share} %${feeBaseSuffix(b)} (exkl moms)`, amountOre: b.sjalvriskNetOre + b.clientExpensesNetOre, kind: "add" });
  }
  // Samma moms-trappa för BÅDA metoderna (#935) — rättsskydd fick förr bara en enda
  // inkl-moms-rad, vilket gjorde klientfakturorna asymmetriska och svårlästa.
  rows.push(...clientVatRows(b, feeCap));
  return { timeLines: b.clientArvodeLines.map(toViewLine), rows, totalLabel: "Att betala (inkl moms)", totalOre: b.clientPayableOre };
}

/**
 * BETALARE (domstol/försäkring): SAMMA upplägg som klientfakturan (#876) — tidsspec
 * + moms-trappa, fast med betalarens ANDEL. Bas-arvode − klientens rättshjälpsavgift
 * − ev. prutning = betalarens andel (netto) → moms → inkl + betalarens utläggsandel
 * (#878). Rådgivningstimmen omnämns som info-rad men ligger UTANFÖR totalen.
 */
export function buildPayerView(b: SettlementBreakdown, payerLabel: string, payerNoun: string, feeTerm: string): SettlementView {
  // Andelarna omfattar BÅDE arvode och utlägg (#947) — de delas i samma proportion,
  // så trappan går hela vägen ned till betalarens totala andel utan lösa rader.
  const clientShareNetOre = b.sjalvriskNetOre + b.clientExpensesNetOre;
  const payerShareNetOre = b.payerArvodeNetOre + b.payerExpensesNetOre;
  const payerVatOre = arvodeInclVatOre(b.payerArvodeNetOre) - b.payerArvodeNetOre + b.payerExpensesVatOre;
  const rows: SettlementRow[] = arvodeLadderRows(b, payerNoun);
  rows.push({ label: `Avgår klientens ${feeTerm} ${shareLabel(b.clientShareBips)} %${feeBaseSuffix(b)} (exkl moms)`, amountOre: clientShareNetOre, kind: "deduct" });
  rows.push({ label: `${payerNoun} andel (exkl moms)`, amountOre: payerShareNetOre, kind: "add" });
  rows.push({ label: vatLabel(payerShareNetOre, payerVatOre), amountOre: payerVatOre, kind: "add" });
  rows.push({ label: `${payerNoun} andel (inkl moms)`, amountOre: payerShareNetOre + payerVatOre, kind: "add" });
  for (const d of b.deductedAccontos) rows.push({ label: `Betalt via aconto — faktura ${d.invoiceNumber}${d.date ? ` (${svd(d.date)})` : ""}`, amountOre: d.amountOre, kind: "info" });
  return { timeLines: b.clientArvodeLines.map(toViewLine), rows, totalLabel: `${payerLabel} — att betala (inkl moms)`, totalOre: b.payerPayableOre };
}

/** Klient- + betalar-vy ur nedbrytningen (#876) — etiketterna följer metoden.
 *  Rättshjälp: klientens del = "rättshjälpsavgift"; rättsskydd: "självrisk" (#878). */
export function buildSettlementViews(b: SettlementBreakdown, method: PaymentMethod): { clientView: SettlementView; payerView: SettlementView } {
  const isRattshjalp = method === "RATTSHJALP";
  const payerLabel = isRattshjalp ? "Domstolen betalar" : "Försäkringen betalar";
  const payerNoun = isRattshjalp ? "Domstolens" : "Försäkringens";
  const feeTerm = isRattshjalp ? "rättshjälpsavgift" : "självrisk";
  return { clientView: buildClientView(b, isRattshjalp, feeTerm), payerView: buildPayerView(b, payerLabel, payerNoun, feeTerm) };
}

/** Kreditvy (#895): SAMMA fulla specifikation som klientens slutfaktura (tidsspec
 *  med á-pris + rättshjälpsavgift-trappan + avdragna aconton, jfr domstolsvyn) — men
 *  eftersom betalda aconton översteg klientens slutliga andel blir nettot NEGATIVT →
 *  en kreditering. Återanvänder `clientView` och byter bara total-etikett + belopp. */
export function buildCreditView(clientView: SettlementView, creditNetOre: number): SettlementView {
  return { ...clientView, totalLabel: "Kreditering till klienten (inkl moms)", totalOre: creditNetOre };
}

/**
 * Klientens slutfaktura vid slutreglering (#878): EN faktura, aldrig en 0.00-rad.
 * Nettot = klientens slutliga andel − betalda aconton:
 *   - > 0 → FINAL (klienten är skyldig resten),
 *   - < 0 → CREDIT (överfakturerad via aconton → mellanskillnaden krediteras),
 *   - = 0 → FINAL 0 (exakt avräknad; ovanligt).
 * Utbrutet så settleCoverage-handlern håller sig ≤8 i komplexitet.
 */
/**
 * Kreditfakturans moms + uppdelning (#977). Uppdelningen bärs med TECKEN, så
 * verifikatet kan bokföra arvode, utlägg och varje momskonto för sig — en
 * kreditnota ska spegla originalet post för post, inte klumpas till ett netto.
 */
export function creditPayload(clientLines: VatBreakdownLine[], deductionOre: number): {
  vatOre: number; vatBreakdown: VatBreakdownLine[];
} {
  return {
    vatOre: -accontoCreditAmounts(clientLines, deductionOre).vatOre,
    vatBreakdown: accontoCreditLines(clientLines, deductionOre),
  };
}
