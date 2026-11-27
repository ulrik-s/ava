/**
 * Frister (#1062, #1735) och Att åtgärda (#1734) — ren logik, ingen I/O.
 *
 * Frister visar tidsfrister och "Bör faktureras". Att åtgärda visar
 * takvarningar och jävskontroller. Förfallna fakturor, misslyckade utskick och
 * faktureringssteg står där man redan arbetar med dem: fakturalistan och
 * ärendets flik Fakturering (#1735).
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
 *
 * Frågan om ett ärende ska avslutas (#2100, `close-suggestion.ts`) är också
 * härledd: den försvinner när tid registreras eller ärendet stängs. Undantaget
 * är **Behåll som aktivt**: det datumet är ett faktum på ärendet
 * (`keptActiveAt`), inte en avfärdad påminnelse. Det säger att någon bedömde
 * att ärendet fortsätter, och frågan räknas från den dagen.
 */

import { BILLING_SHORTCUT_PARAM } from "./billing/billing-flow";
import { coverageStatus, type CoverageCapInput } from "./billing/coverage-cap";
import type { MatterRole } from "./schemas/enums";
import { stockholmDay } from "./stockholm-time";

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
  | "conflictCheck"    // jävskontrollen väntar eller har träffar (#1246)
  | "closeSuggestion"; // ska ärendet avslutas? ingen tid på länge (#2100)

/**
 * `passed` = det har redan hänt (taket passerat, fristen ute, utskicket
 * misslyckat). `approaching` = det kommer att hända om inget görs.
 */
export type WatchlistSeverity = "passed" | "approaching";

/**
 * Vart en rad leder (#1215): route + id i stället för en färdig URL, så UI:t kan
 * navigera via `EntityLink` — en Next-`<Link>` till `/matters/<id>` hittar ingen
 * route för ärenden som skapats efter bygget (static export) och gör ingenting.
 */
export interface WatchlistLink {
  route: "matters" | "invoices";
  id: string;
  /**
   * Extra query-parametrar efter `?id=` (#1854), t.ex. att ärendesidan ska
   * öppna faktureringen. Utelämnad = bara detaljsidan.
   */
  query?: Readonly<Record<string, string>>;
}

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
  /** Vart man går för att åtgärda — null när posten saknar ärende/faktura. */
  link: WatchlistLink | null;
  /** Uppgiften bakom en tidsfrist — så den kan bockas av direkt i listan (#1167). */
  taskId?: string;
  /** Ska ärendet avslutas (#2100): titeln till frågan och dagen sedan dess ingen tid registrerats. */
  closeSuggestion?: { matterTitle: string; noTimeSince: string };
  /**
   * Ärendets första KLIENT-part (#1965), som Frister på Startsidan och sidan
   * Frister visar överst på raden. Saknas när posten saknar ärende eller
   * ärendet saknar klient.
   */
  klientName?: string;
}

/** En part i ett ärende — strukturellt samma som `matters.listPartiesFor` ger. */
export interface WatchlistParty { role: MatterRole; name: string }

/** Ärendenas parter per ärende-id, i ärendets ordning (KLIENT först). */
export type WatchlistPartiesByMatter = ReadonlyMap<string, readonly WatchlistParty[]>;

/** Namnet på ärendets första KLIENT-part, eller undefined. */
export function klientNameOf(parties: readonly WatchlistParty[] | undefined): string | undefined {
  return parties?.find((p) => p.role === "KLIENT")?.name;
}

/**
 * Lägg klientens namn på posterna (#1965). En post utan ärende, eller i ett
 * ärende utan klient, lämnas som den är. Ren logik: parterna läses i routern.
 */
export function withKlientNames(items: readonly WatchlistItem[], parties: WatchlistPartiesByMatter): WatchlistItem[] {
  return items.map((item) => {
    const klientName = item.matterId === null ? undefined : klientNameOf(parties.get(item.matterId));
    return klientName === undefined ? item : { ...item, klientName };
  });
}

/** Passerat före annalkande; inom samma grupp: äldst datum först. */
const SEVERITY_ORDER: Record<WatchlistSeverity, number> = { passed: 0, approaching: 1 };

/**
 * Hur bråttom posten är (lägre = först). En tidsfrist som går ut `today` går
 * först: det är sista dagen den går att hålla, medan det som redan passerat
 * inte blir värre av en dag till. Med många förfallna fakturor hamnade dagens
 * frist annars utanför startsidans fem poster.
 */
function urgencyRank(i: WatchlistItem, today: string | undefined): number {
  const lastDay = i.kind === "deadline" && i.severity === "approaching" && i.at === today;
  return lastDay ? -1 : SEVERITY_ORDER[i.severity];
}

/**
 * Sortera efter hur bråttom det är. Poster utan datum hamnar sist inom sin
 * grupp — ett belopp är angeläget men inte tidsstyrt, och en lista som blandar
 * "förfallen i förrgår" med "25 000 kr ofakturerat" ska visa det förfallna först.
 * `today` ("YYYY-MM-DD", byråns tidszon) lyfter dagens tidsfrister överst.
 */
export function sortWatchlist(items: readonly WatchlistItem[], today?: string): WatchlistItem[] {
  return [...items].sort((a, b) => {
    const bySeverity = urgencyRank(a, today) - urgencyRank(b, today);
    if (bySeverity !== 0) return bySeverity;
    if (a.at !== null && b.at !== null) return a.at.localeCompare(b.at);
    if (a.at !== null) return -1;
    if (b.at !== null) return 1;
    return (b.amountOre ?? 0) - (a.amountOre ?? 0);
  });
}

// ─── Härledning per signal ─────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** Hela kalenderdagar (svensk tid) mellan två tidpunkter (b − a). Negativt = b ligger före a. */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((Date.parse(stockholmDay(to)) - Date.parse(stockholmDay(from))) / DAY_MS);
}

const iso = (d: Date): string => stockholmDay(d);

/** "1 dag" / "3 dagar" — svensk pluralböjning. "om 1 dagar" ser trasigt ut. */
export function dagar(n: number): string {
  return n === 1 ? "1 dag" : `${n} dagar`;
}

/** "idag" / "imorgon" / "om 3 dagar" — noll dagar kvar är inte "om 0 dagar". */
function omDagar(n: number): string {
  if (n === 0) return "idag";
  if (n === 1) return "imorgon";
  return `om ${dagar(n)}`;
}

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
    link: { route: "matters", id: m.id },
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
  if (överBelopp && förGammalt) return `över tröskeln och ${dagar(ålder)} gammalt`;
  if (överBelopp) return "över tröskeln";
  if (förGammalt) return `${dagar(ålder)} gammalt`;
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
      // Raden öppnar faktureringen direkt (#1854); ärendesidan avgör vad.
      link: { route: "matters", id: m.id, query: { [BILLING_SHORTCUT_PARAM]: "1" } },
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
      title: passerad ? `Tidsfrist passerad: ${task.title}` : `Tidsfrist ${omDagar(kvar)}: ${task.title}`,
      detail: passerad
        ? `Fristen gick ut för ${dagar(Math.abs(kvar))} sedan.`
        : `Förfaller ${iso(new Date(task.dueAt))}.`,
      matterId: task.matterId, matterNumber: task.matterNumber,
      at: iso(new Date(task.dueAt)), amountOre: null,
      link: task.matterId ? { route: "matters", id: task.matterId } : null,
      taskId: task.id,
    });
  }
  return out;
}

// ─── Jävskontroll (#1246) ─────────────────────────────────────────────────

/** Ärendets jävskontroll, som den ligger på ärendet. */
export interface ConflictCheckMatter {
  id: string;
  matterNumber: string;
  status?: string | null;
  conflictCheckStatus?: string | null;
  conflictCheckHits?: number | null;
}

const isOpenMatter = (m: ConflictCheckMatter): boolean => m.status !== "CLOSED" && m.status !== "ARCHIVED";

function conflictCheckItem(m: ConflictCheckMatter): WatchlistItem | null {
  const base = { kind: "conflictCheck" as const, matterId: m.id, matterNumber: m.matterNumber, at: null, amountOre: null, link: { route: "matters" as const, id: m.id } };
  if (m.conflictCheckStatus === "HITS") {
    return {
      ...base, severity: "passed",
      title: `Jävskontroll: ${m.conflictCheckHits ?? 0} träffar att bedöma`,
      detail: "En part står på andra sidan i ett av byråns andra ärenden. Bedöm träffarna innan uppdraget tas.",
    };
  }
  if (m.conflictCheckStatus !== "PENDING") return null;
  return {
    ...base, severity: "approaching",
    title: "Jävskontroll väntar",
    detail: "Kontrollen är inte gjord mot byråns alla ärenden. Den körs när ärendet har synkats, eller när klienten lagts till och kontrollen körs om.",
  };
}

/**
 * Ärenden vars jävskontroll inte är klar. Advokatetiken kräver kontrollen innan
 * uppdraget tas, och ett ärende som skapats offline har bara kontrollerats mot
 * den lokala kopian. Träffar är mer akuta än en kontroll som väntar.
 */
export function conflictCheckItems(matters: readonly ConflictCheckMatter[]): WatchlistItem[] {
  return matters.filter(isOpenMatter).map(conflictCheckItem).filter((i): i is WatchlistItem => i !== null);
}
