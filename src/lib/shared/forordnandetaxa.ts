/**
 * `forordnandetaxa` — ersättning till offentlig försvarare i FÖRORDNANDEMÅL:
 * förundersökningen lades ned, strafföreläggande godkändes eller FU avslutades
 * utan åtal. Ett brottmål som startat med löpande debitering slutar då som ett
 * taxeärende där beloppet bestäms av FÖRHÖRSTIDEN.
 *
 * Källor (avlästa ur föreskrifterna, inte ur minnet):
 *   2026: DVFS 2025:5 — https://www.domstol.se/globalassets/filer/gemensamt-innehall/
 *         for-professionella-aktorer/dvfs/2025/dvfs_2025-5.pdf
 *   2025: DVFS 2024:16 (samma paragrafer, andra belopp)
 *   Tidsspillan: DVFS 2025:4 (1 487 kr/h vardag 08–18, 975 kr/h annan tid)
 *
 * Reglerna som kod:
 *   - 5 §  Förhörstiden för ALLA förhör läggs samman. Förhör = från att
 *          förhörsledaren inleder till att förhöret förklaras avslutat; uppehåll
 *          KORTARE än 15 min räknas in, längre dras av.
 *   - 3 §  Gäller bara förhör på vardagar 07.00–18.00 och sammanlagt ≤ 3 h 45 min;
 *          annars tillämpas inte taxan (4 § andra st.) → löpande räkning.
 *   - 6 §  Inga förhör alls → lägsta taxebeloppet.
 *   - 7 §  Taxan omfattar ALLT arbete — den löpande tiden före nedläggningen
 *          redovisas men ersätts inte utöver taxan.
 *   - 8 §  Taxan omfattar EN timmes tidsspillan, i första hand tid före 08 / efter
 *          18. Resten ersätts enligt tidsspillan-föreskriften.
 *   - 10 § Överstiger skälig ersättning gränsvärdet får taxan frångås.
 *   - 13 § Utan F-skatt × årets kvot (1237/1626 för 2026).
 *
 * Beloppen i bilagan är IDENTISKA med brottmålstaxans nivå 1 för samma år
 * (kontrollerat mot båda årgångarna), så tabellen återanvänds.
 */

import {
  applyNoFTaxFactorForDate, computeBrottmalstaxa, TAXA_MAX_MINUTES,
  tidsspillanFtaxForDate, tidsspillanOvrigFtaxForDate, type TaxaResult,
} from "./brottmalstaxa";

/** Ett uppehåll i ett förhör. */
export interface ForhorPaus {
  start: Date | string;
  end: Date | string;
}

/** Ett förhör under förundersökningen där försvararen närvarade. */
export interface Forhor {
  start: Date | string;
  end: Date | string;
  pauses?: readonly ForhorPaus[];
}

/** Uppehåll kortare än så här räknas in i förhörstiden (5 § tredje st.). */
export const FORHOR_PAUS_GRANS_MINUTES = 15;

/** Den timme tidsspillan som ingår i taxan (8 §). */
export const TIDSSPILLAN_INGAR_MINUTES = 60;

const minutesBetween = (a: Date | string, b: Date | string): number =>
  Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

/** Ett förhörs tid: hela förhöret minus uppehåll på 15 min eller mer. */
export function forhorMinutes(f: Forhor): number {
  const excluded = (f.pauses ?? [])
    .map((p) => minutesBetween(p.start, p.end))
    .filter((m) => m >= FORHOR_PAUS_GRANS_MINUTES)
    .reduce((s, m) => s + m, 0);
  return Math.max(0, minutesBetween(f.start, f.end) - excluded);
}

/** Klockslag i Stockholm som minuter efter midnatt + veckodag (0 = söndag). */
function stockholmClock(d: Date | string): { weekday: number; minuteOfDay: number; day: string } {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Stockholm", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(d));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["sön", "mån", "tis", "ons", "tors", "fre", "lör"].indexOf(get("weekday"));
  return { weekday, minuteOfDay: Number(get("hour")) * 60 + Number(get("minute")), day: `${get("year")}-${get("month")}-${get("day")}` };
}

// ponytail: helgfria vardagar = mån–fre; allmänna helgdagar (t.ex. långfredag) upptäcks inte — lägg till en helgdagskalender om det behövs.
/** Hela förhöret på en vardag mellan 07.00 och 18.00 (3 §)? */
export function isWithinTaxaHours(f: Forhor): boolean {
  const s = stockholmClock(f.start);
  const e = stockholmClock(f.end);
  const weekday = s.weekday >= 1 && s.weekday <= 5;
  return weekday && s.day === e.day && s.minuteOfDay >= 7 * 60 && e.minuteOfDay <= 18 * 60;
}

/** Varför taxan inte tillämpas — då räknas ärendet löpande. */
export type UtanforTaxanReason = "over-max" | "utanfor-tid";

export interface ForordnandeInput {
  forhor: readonly Forhor[];
  /** Registrerad tidsspillan (minuter): vardag 08–18 resp. annan tid. */
  tidsspillan: { vardagMinutes: number; ovrigMinutes: number };
  hasFTax?: boolean;
  /** Yrkandedatumet väljer årgång (övergångsbestämmelsen, punkt 4). */
  yrkandeDate: Date | string;
  /** Skälig ersättning för det faktiska arbetet (löpande värde) — mot gränsvärdet (10 §). */
  skaligErsattningOre?: number;
}

export interface TidsspillanUtover {
  /** Minuter av den ingående timmen som togs från annan tid resp. vardag. */
  ingarOvrigMinutes: number;
  ingarVardagMinutes: number;
  /** Minuter UTÖVER den ingående timmen som ersätts. */
  extraVardagMinutes: number;
  extraOvrigMinutes: number;
  /** Timpris per kategori efter ev. F-skattejustering (öre/h). */
  vardagRateOre: number;
  ovrigRateOre: number;
  /** Ersättning för det överskjutande, exkl moms (öre). */
  amountOre: number;
}

export type ForordnandeResult =
  | {
    kind: "taxa";
    forhorMinutes: number;
    taxa: TaxaResult;
    tidsspillan: TidsspillanUtover;
    /** Taxa + överskjutande tidsspillan, exkl moms (öre). */
    arvodeExclVat: number;
    /** Skälig ersättning > gränsvärdet → taxan FÅR frångås (10 §). */
    gransvardeOverskrids: boolean;
  }
  | { kind: "utanfor-taxan"; forhorMinutes: number; reason: UtanforTaxanReason };

/** Den ingående timmen dras i första hand från annan tid (8 §). */
export function tidsspillanUtover(
  t: ForordnandeInput["tidsspillan"], date: Date | string, hasFTax: boolean,
): TidsspillanUtover {
  const ingarOvrigMinutes = Math.min(t.ovrigMinutes, TIDSSPILLAN_INGAR_MINUTES);
  const ingarVardagMinutes = Math.min(t.vardagMinutes, TIDSSPILLAN_INGAR_MINUTES - ingarOvrigMinutes);
  const extraOvrigMinutes = t.ovrigMinutes - ingarOvrigMinutes;
  const extraVardagMinutes = t.vardagMinutes - ingarVardagMinutes;
  const adjust = (ore: number): number => (hasFTax ? ore : applyNoFTaxFactorForDate(ore, date));
  const ore = Math.round((extraVardagMinutes * tidsspillanFtaxForDate(date) + extraOvrigMinutes * tidsspillanOvrigFtaxForDate(date)) / 60);
  return {
    ingarOvrigMinutes, ingarVardagMinutes, extraVardagMinutes, extraOvrigMinutes,
    vardagRateOre: adjust(tidsspillanFtaxForDate(date)),
    ovrigRateOre: adjust(tidsspillanOvrigFtaxForDate(date)),
    amountOre: adjust(ore),
  };
}

/** Ersättning i ett förordnandemål, eller skälet till att taxan inte gäller. */
export function computeForordnandeErsattning(input: ForordnandeInput): ForordnandeResult {
  const total = input.forhor.reduce((s, f) => s + forhorMinutes(f), 0);
  if (!input.forhor.every(isWithinTaxaHours)) return { kind: "utanfor-taxan", forhorMinutes: total, reason: "utanfor-tid" };
  if (total > TAXA_MAX_MINUTES) return { kind: "utanfor-taxan", forhorMinutes: total, reason: "over-max" };
  const hasFTax = input.hasFTax ?? true;
  // 6 §: inga förhör → lägsta beloppet, vilket är tabellens första intervall (0 min).
  const taxa = computeBrottmalstaxa({ huvudforhandlingMinutes: total, level: 1, hasFTax, yrkandeDate: input.yrkandeDate });
  const tidsspillan = tidsspillanUtover(input.tidsspillan, input.yrkandeDate, hasFTax);
  return {
    kind: "taxa", forhorMinutes: total, taxa, tidsspillan,
    arvodeExclVat: taxa.ersattningExclVat + tidsspillan.amountOre,
    gransvardeOverskrids: (input.skaligErsattningOre ?? 0) > taxa.gransvardeExclVat,
  };
}
