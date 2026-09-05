/**
 * "Att bevaka" (#1062) — ren logik, ingen I/O.
 *
 * Byrån har fem sorters signaler som var för sig redan syns någonstans i
 * gränssnittet, men bara DÄR MAN REDAN TITTAR: täckningsvarningen inne i
 * ärendet, förfallodatumet på fakturan, statusen på ett utskick. En påminnelse
 * ska fungera tvärtom — man ska få veta utan att öppna något.
 *
 * ## Varför inget lagras
 *
 * Ingen `Reminder`-entitet, ingen avfärda-knapp. Varje post här är HÄRLEDD ur
 * data som redan finns, och städar därför sig själv: fakturera ärendet och
 * posten försvinner, betala fakturan och den försvinner. En lagrad påminnelse
 * hade krävt att någon avfärdar den, och därmed skapat en andra sanningskälla
 * som kan säga något annat än verkligheten.
 *
 * Priset är att man inte kan "snooza" en post. Det är rätt pris: en påminnelse
 * som går att tysta utan att åtgärda är en påminnelse som kommer att tystas.
 *
 * Tidsfrister (dokument som ska in, överklagandetider) är INTE härledbara —
 * de är uppgifter någon skrivit in, alltså `Task` med `dueAt`. De tas med här
 * för att de hör hemma i samma vy, inte för att de räknas ut.
 */

import { coverageStatus, type CoverageCapInput } from "./coverage-cap";

// ─── Trösklar ──────────────────────────────────────────────────────────────

/** Ofakturerat över detta belopp (öre) är värt en påminnelse. Byrå-överstyrbart. */
export const DEFAULT_UNBILLED_THRESHOLD_ORE = 2_500_000; // 25 000 kr

/** …liksom arbete som legat ofakturerat längre än så här många dagar. */
export const DEFAULT_UNBILLED_AGE_DAYS = 60;

/** Tidsfrister inom så här många dagar räknas som "närmar sig". */
export const DEADLINE_HORIZON_DAYS = 14;

export interface WatchlistThresholds {
  unbilledThresholdOre: number;
  unbilledAgeDays: number;
  deadlineHorizonDays: number;
}

export const DEFAULT_THRESHOLDS: WatchlistThresholds = {
  unbilledThresholdOre: DEFAULT_UNBILLED_THRESHOLD_ORE,
  unbilledAgeDays: DEFAULT_UNBILLED_AGE_DAYS,
  deadlineHorizonDays: DEADLINE_HORIZON_DAYS,
};

// ─── Poster ────────────────────────────────────────────────────────────────

/**
 * Vad posten gäller. Sorteringen nedan bygger på `severity`, inte på `kind` —
 * en passerad tidsfrist är mer akut än ett täckningstak som närmar sig, oavsett
 * vilken sort de är.
 */
export type WatchlistKind =
  | "coverageCap"      // täckningstaket nås — arbete däröver ersätts inte
  | "unbilled"         // upparbetat som borde faktureras
  | "deadline"         // tidsfrist ur en uppgift (dokument, överklagande)
  | "overdueInvoice"   // förfallen faktura eller avbetalningspost
  | "failedDispatch";  // fakturan nådde aldrig mottagaren

/**
 * `passed` = det har redan hänt (taket passerat, fristen ute, utskicket
 * misslyckat). `approaching` = det kommer att hända om inget görs.
 */
export type WatchlistSeverity = "passed" | "approaching";

export interface WatchlistItem {
  kind: WatchlistKind;
  severity: WatchlistSeverity;
  /** Kort rubrik — vad som händer. */
  title: string;
  /** En rad om varför det spelar roll och vad man gör åt det. */
  detail: string;
  matterId: string | null;
  matterNumber: string | null;
  /** Datum posten hänger på (frist, förfallodag). Null för beloppsdrivna. */
  at: string | null;
  /** Belopp posten gäller (öre), när det finns ett. */
  amountOre: number | null;
  /** Vart man går för att åtgärda. */
  href: string;
}

/** Passerat före annalkande; inom samma grupp: äldst datum först. */
const SEVERITY_ORDER: Record<WatchlistSeverity, number> = { passed: 0, approaching: 1 };

/**
 * Sortera efter hur bråttom det är. Poster utan datum hamnar sist inom sin
 * grupp — ett belopp är angeläget men inte tidsstyrt, och en lista som blandar
 * "förfallen i förrgår" med "25 000 kr ofakturerat" ska visa det förfallna först.
 */
export function sortWatchlist(items: readonly WatchlistItem[]): WatchlistItem[] {
  return [...items].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (a.at !== null && b.at !== null) return a.at.localeCompare(b.at);
    if (a.at !== null) return -1;
    if (b.at !== null) return 1;
    return (b.amountOre ?? 0) - (a.amountOre ?? 0);
  });
}

// ─── Härledning per signal ─────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Hela dagar mellan två datum (b − a). Negativt = b ligger före a. */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const b = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

const iso = (d: Date): string => d.toISOString().slice(0, 10);

export interface CoverageMatter extends CoverageCapInput {
  id: string;
  matterNumber: string;
}

/**
 * Täckningstaket. Arbete över taket ersätts inte av myndigheten/försäkringen —
 * byrån får själv bära det om den inte hunnit begära utökning. Därför är det
 * ANNALKANDE fallet det viktiga: passerat tak är redan en förlust.
 */
function coverageItem(m: CoverageMatter, status: NonNullable<ReturnType<typeof coverageStatus>>): WatchlistItem {
  const pct = Math.round(status.ratio * 100);
  const utokning = m.method === "RATTSHJALP" ? "utökad rättshjälp" : "utökat rättsskydd";
  return {
    kind: "coverageCap",
    severity: status.overCap ? "passed" : "approaching",
    title: status.overCap ? `Täckningstaket passerat (${pct} %)` : `Närmar sig täckningstaket (${pct} %)`,
    detail: status.overCap
      ? `Arbete över taket ersätts inte — begär ${utokning} omgående.`
      : `Begär ${utokning} innan taket nås.`,
    matterId: m.id, matterNumber: m.matterNumber, at: null,
    amountOre: status.kind === "amount" ? status.usedOre : null,
    href: `/matters/${m.id}`,
  };
}

export function coverageItems(matters: readonly CoverageMatter[]): WatchlistItem[] {
  const out: WatchlistItem[] = [];
  for (const m of matters) {
    const status = coverageStatus(m);
    if (status?.nearCap) out.push(coverageItem(m, status));
  }
  return out;
}

export interface UnbilledMatter {
  id: string;
  matterNumber: string;
  /** Ofakturerat arbete + utlägg (öre). */
  unbilledOre: number;
  /** Datum för den ÄLDSTA ofakturerade posten, eller null om inget finns. */
  oldestEntryDate: string | null;
}

/**
 * Vilken/vilka trösklar som slog till, som läsbart skäl. Null = ingen.
 *
 * Två OBEROENDE trösklar, och vilken som helst räcker: beloppet fångar de
 * stora ärendena, åldern fångar de små som glider. Bara beloppsgränsen hade
 * missat ett ärende med 8 000 kr som legat i ett halvår — och det är precis
 * den sortens fordran som aldrig blir fakturerad.
 */
function unbilledReason(m: UnbilledMatter, now: Date, t: WatchlistThresholds): string | null {
  if (m.unbilledOre <= 0) return null;
  const ålder = m.oldestEntryDate === null ? 0 : daysBetween(new Date(m.oldestEntryDate), now);
  const överBelopp = m.unbilledOre >= t.unbilledThresholdOre;
  const förGammalt = m.oldestEntryDate !== null && ålder >= t.unbilledAgeDays;
  if (överBelopp && förGammalt) return `över tröskeln och ${ålder} dagar gammalt`;
  if (överBelopp) return "över tröskeln";
  if (förGammalt) return `${ålder} dagar gammalt`;
  return null;
}

/** Ofakturerat arbete som passerat någon av trösklarna. */
export function unbilledItems(
  matters: readonly UnbilledMatter[], now: Date, t: WatchlistThresholds = DEFAULT_THRESHOLDS,
): WatchlistItem[] {
  const out: WatchlistItem[] = [];
  for (const m of matters) {
    const skäl = unbilledReason(m, now, t);
    if (skäl === null) continue;
    out.push({
      kind: "unbilled",
      // Ofakturerat är aldrig "passerat" — det finns ingen tidpunkt att missa,
      // bara pengar som står stilla längre och längre.
      severity: "approaching",
      title: "Bör faktureras",
      detail: `Upparbetat ofakturerat ${skäl}.`,
      matterId: m.id, matterNumber: m.matterNumber,
      at: m.oldestEntryDate, amountOre: m.unbilledOre,
      href: `/matters/${m.id}`,
    });
  }
  return out;
}

export interface DeadlineTask {
  id: string;
  title: string;
  dueAt: string;
  matterId: string | null;
  matterNumber: string | null;
}

/**
 * Tidsfrister ur uppgifter — dokument som ska ges in, överklagandetider. De
 * räknas inte ut; de är inskrivna. Det som saknades var att se dem sorterade
 * efter frist över ALLA ärenden i stället för ett i taget.
 */
export function deadlineItems(
  tasks: readonly DeadlineTask[], now: Date, t: WatchlistThresholds = DEFAULT_THRESHOLDS,
): WatchlistItem[] {
  const out: WatchlistItem[] = [];
  for (const task of tasks) {
    const kvar = daysBetween(now, new Date(task.dueAt));
    if (kvar > t.deadlineHorizonDays) continue;
    const passerad = kvar < 0;
    out.push({
      kind: "deadline",
      severity: passerad ? "passed" : "approaching",
      title: passerad ? `Tidsfrist passerad: ${task.title}` : `Tidsfrist om ${kvar} dagar: ${task.title}`,
      detail: passerad
        ? `Fristen gick ut för ${Math.abs(kvar)} dagar sedan.`
        : `Förfaller ${iso(new Date(task.dueAt))}.`,
      matterId: task.matterId, matterNumber: task.matterNumber,
      at: iso(new Date(task.dueAt)), amountOre: null,
      href: task.matterId ? `/matters/${task.matterId}` : "/tasks",
    });
  }
  return out;
}

export interface OverdueInvoice {
  id: string;
  invoiceNumber: string | null;
  dueDate: string;
  outstandingOre: number;
  matterId: string | null;
  matterNumber: string | null;
}

/** Förfallna fakturor — fordran som glider. Bara obetalt räknas. */
export function overdueInvoiceItems(invoices: readonly OverdueInvoice[], now: Date): WatchlistItem[] {
  const out: WatchlistItem[] = [];
  for (const inv of invoices) {
    if (inv.outstandingOre <= 0) continue;
    const dagar = daysBetween(new Date(inv.dueDate), now);
    if (dagar <= 0) continue;
    out.push({
      kind: "overdueInvoice",
      severity: "passed",
      title: `Förfallen faktura ${inv.invoiceNumber ?? ""}`.trim(),
      detail: `${dagar} dagar över förfallodag.`,
      matterId: inv.matterId, matterNumber: inv.matterNumber,
      at: inv.dueDate, amountOre: inv.outstandingOre,
      href: `/invoices/${inv.id}`,
    });
  }
  return out;
}

export interface FailedDispatch {
  invoiceId: string;
  invoiceNumber: string | null;
  recipient: string;
  error: string | null;
  failedAt: string | null;
  matterId: string | null;
  matterNumber: string | null;
}

/**
 * Misslyckade fakturautskick. Den här är listans viktigaste post trots att den
 * sällan är den dyraste: alla andra signaler kan en människa snubbla över, men
 * en faktura som aldrig nådde mottagaren ser ut precis som en obetald faktura
 * ända tills någon undrar varför ingen betalat.
 */
export function failedDispatchItems(dispatches: readonly FailedDispatch[]): WatchlistItem[] {
  return dispatches.map((d) => ({
    kind: "failedDispatch" as const,
    severity: "passed" as const,
    title: `Fakturautskick misslyckades ${d.invoiceNumber ?? ""}`.trim(),
    detail: `Nådde aldrig ${d.recipient}${d.error ? ` — ${d.error}` : ""}. Fakturan är obetald för att den inte kommit fram.`,
    matterId: d.matterId, matterNumber: d.matterNumber,
    at: d.failedAt, amountOre: null,
    href: `/invoices/${d.invoiceId}`,
  }));
}
