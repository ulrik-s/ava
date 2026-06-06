/**
 * `brottmalstaxa` — Domstolsverkets föreskrifter om brottmålstaxa för
 * offentlig försvarare i tingsrätt och hovrätt.
 *
 * Bygger på **DVFS 2025:6** (gäller fr.o.m. 2026-01-01). Tabellen
 * är fastställd av Domstolsverket och uppdateras årligen — vid byte
 * av år: byt ut `BROTTMALSTAXA_TABLE` mot nya beloppen.
 *
 * Källa:
 *   https://www.domstol.se/globalassets/filer/gemensamt-innehall/for-
 *   professionella-aktorer/dvfs/2025/dvfs_2025-6.pdf
 *
 * Tillämpning:
 *   - En tilltalad + en offentlig försvarare
 *   - Sammanlagd förhandlingstid ≤ 3 tim 45 min (= 225 min)
 *   - Vid hovrätt: försvararen måste ha biträtt redan i tingsrätten
 *   - HUF > 225 min → taxan tillämpas INTE → faktisk tid × timkostnadsnorm
 *
 * Ersättningsnivåer:
 *   1 = Bara huvudförhandling (grundersättning)
 *   2 = HUF + häktningsförhandling / kvarstad / beslag / reseförbud
 *   3 = HUF + RPU (rättspsykiatrisk undersökning)
 *   4 = HUF + (häktning etc.) + RPU
 *
 * Belopp är **EXKL moms** (öre, dvs kr × 100).
 *
 * Vid F-skatt-saknad: belopp × 1237/1626 (timkostnadsnorm utan/med F-skatt).
 */

export type TaxaLevel = 1 | 2 | 3 | 4;

/** Maxgräns för när taxan tillämpas (= 3 tim 45 min). */
export const TAXA_MAX_MINUTES = 225;

/** Kvot för advokat utan F-skatt: timkostnadsnorm 1237 / 1626 (DVFS 11 §). */
export const NO_FTAX_FACTOR_NUMERATOR = 1237;
export const NO_FTAX_FACTOR_DENOMINATOR = 1626;

/**
 * Domstolsverkets timkostnadsnorm 2026 (DVFS 2025:6 § 8). Använd för
 * statligt betalda ärenden som INTE är taxemål — t.ex. komplexa brottmål
 * där HUF > 3 tim 45 min, eller rättshjälp i tvistemål, eller offentligt
 * biträde i förvaltningsmål (LVU, LPT, asyl, m.m.).
 *
 * Belopp i öre per timme, exkl moms.
 */
export const TIMKOSTNADSNORM_FTAX_ORE_PER_H = 162_600; // 1 626 kr/h
export const TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H = 123_700; // 1 237 kr/h

/**
 * Beräkna ersättning enligt timkostnadsnorm × tid (öre, exkl moms).
 *
 * Vanligast användningsfall:
 *   - HUF > 225 min (taxan tillämpas inte → ersättning enligt
 *     timkostnadsnorm × hela arbetstiden)
 *   - Rättshjälp i tvistemål (LRF; non-taxemål)
 *   - Offentligt biträde i förvaltningsmål
 *
 * `tidsspillanMinutes` ersätts med samma timkostnadsnorm (DV-praxis).
 */
export function computeTimkostnadsnorm(opts: {
  arbetsMinutes: number;
  tidsspillanMinutes?: number;
  hasFTax?: boolean;
}): { arbete: number; tidsspillan: number; total: number; rateOrePerH: number } {
  const hasFTax = opts.hasFTax ?? true;
  const rate = hasFTax ? TIMKOSTNADSNORM_FTAX_ORE_PER_H : TIMKOSTNADSNORM_NO_FTAX_ORE_PER_H;
  const arbete = Math.round((opts.arbetsMinutes * rate) / 60);
  const tidsspillan = Math.round(((opts.tidsspillanMinutes ?? 0) * rate) / 60);
  return { arbete, tidsspillan, total: arbete + tidsspillan, rateOrePerH: rate };
}

interface TaxaRow {
  /** Start av intervallet i minuter (inklusivt). */
  fromMin: number;
  /** Slut av intervallet i minuter (inklusivt). */
  toMin: number;
  /** Mänsklig label, t.ex. "1 tim 30 min - 1 tim 44 min". */
  label: string;
  /** Ersättning i öre per nivå (1-4), exkl moms, F-skatt. */
  ersattning: readonly [number, number, number, number];
  /** Gränsvärde i öre per nivå — om skälig ersättning överstiger
   *  detta får taxan frångås (= avsevärt mer arbete). */
  gransvarde: readonly [number, number, number, number];
}

/**
 * DVFS 2025:6 Bilaga. Belopp i öre (kr × 100). Källans tabell:
 *
 *   Förhandlingstid | Nivå 1 | Nivå 2 | Nivå 3 | Nivå 4
 *   (gränsvärden inom parentes nedanför nivåbeloppen i källan)
 */
export const BROTTMALSTAXA_TABLE: readonly TaxaRow[] = [
  { fromMin:   0, toMin:  14, label: "0-14 min",
    ersattning: [280900, 418500, 547000, 684600], gransvarde: [421900, 627900, 820700, 1010200] },
  { fromMin:  15, toMin:  29, label: "15-29 min",
    ersattning: [298000, 435600, 564100, 701700], gransvarde: [446700, 652700, 845500, 1025600] },
  { fromMin:  30, toMin:  44, label: "30-44 min",
    ersattning: [350900, 488500, 617000, 754600], gransvarde: [527100, 732600, 942500, 1078500] },
  { fromMin:  45, toMin:  59, label: "45-59 min",
    ersattning: [404900, 542500, 671000, 808600], gransvarde: [606500, 811900, 995400, 1133100] },
  { fromMin:  60, toMin:  74, label: "1 tim - 1 tim 14 min",
    ersattning: [458300, 595900, 724400, 862000], gransvarde: [685800, 892900, 1048800, 1185400] },
  { fromMin:  75, toMin:  89, label: "1 tim 15 min - 1 tim 29 min",
    ersattning: [510600, 648200, 776700, 914300], gransvarde: [766200, 973900, 1102200, 1239900] },
  { fromMin:  90, toMin: 104, label: "1 tim 30 min - 1 tim 44 min",
    ersattning: [563500, 701100, 829600, 967200], gransvarde: [846100, 1025600, 1154500, 1291700] },
  { fromMin: 105, toMin: 119, label: "1 tim 45 min - 1 tim 59 min",
    ersattning: [616400, 754000, 882500, 1020100], gransvarde: [942500, 1078500, 1208500, 1344600] },
  { fromMin: 120, toMin: 134, label: "2 tim - 2 tim 14 min",
    ersattning: [670400, 808000, 936500, 1074100], gransvarde: [995400, 1133100, 1260900, 1399100] },
  { fromMin: 135, toMin: 149, label: "2 tim 15 min - 2 tim 29 min",
    ersattning: [722700, 860300, 988800, 1126400], gransvarde: [1048800, 1185400, 1314300, 1451400] },
  { fromMin: 150, toMin: 164, label: "2 tim 30 min - 2 tim 44 min",
    ersattning: [776700, 914300, 1042800, 1180400], gransvarde: [1102200, 1239900, 1367700, 1504900] },
  { fromMin: 165, toMin: 179, label: "2 tim 45 min - 2 tim 59 min",
    ersattning: [830100, 967700, 1096200, 1233800], gransvarde: [1155100, 1292200, 1420600, 1557700] },
  { fromMin: 180, toMin: 194, label: "3 tim - 3 tim 14 min",
    ersattning: [882400, 1020000, 1148500, 1286100], gransvarde: [1209100, 1345100, 1475100, 1611700] },
  { fromMin: 195, toMin: 209, label: "3 tim 15 min - 3 tim 29 min",
    ersattning: [936400, 1074000, 1202500, 1340100], gransvarde: [1260900, 1399100, 1526900, 1664100] },
  { fromMin: 210, toMin: 225, label: "3 tim 30 min - 3 tim 45 min",
    ersattning: [988700, 1126300, 1254800, 1392400], gransvarde: [1314300, 1451400, 1580300, 1717500] },
];

export interface ComputeOpts {
  /** Sammanlagd förhandlingstid (minuter) — räknas från målets påropas. */
  huvudforhandlingMinutes: number;
  /** Ersättningsnivå (1-4). Se nivåförklaringarna i fil-toppen. */
  level: TaxaLevel;
  /** Default true. False → multiplicera med 1237/1626. */
  hasFTax?: boolean;
}

export type TaxaResultKind = "taxa-applies" | "exceeds-max" | "invalid-input";

export interface TaxaResult {
  kind: TaxaResultKind;
  /** Intervall-label, t.ex. "1 tim 30 min - 1 tim 44 min". Tom om exceeds-max. */
  intervalLabel: string;
  /** Vald nivå. */
  level: TaxaLevel;
  /** Ersättning i öre, EXKL moms (efter F-skatt-justering). */
  ersattningExclVat: number;
  /** Gränsvärde i öre, EXKL moms (efter F-skatt-justering). */
  gransvardeExclVat: number;
  /** Användbart anteckning till UI:n. */
  notes: string[];
}

/**
 * Beräkna ersättning enligt brottmålstaxan. Returnerar alltid ett objekt;
 * `kind` säger om taxan tillämpas eller om man måste falla tillbaka på
 * löpande räkning (HUF > 225 min) eller om input var ogiltigt.
 */
// eslint-disable-next-line complexity
export function computeBrottmalstaxa(opts: ComputeOpts): TaxaResult {
  const { huvudforhandlingMinutes: huf, level } = opts;
  const hasFTax = opts.hasFTax ?? true;

  if (!Number.isFinite(huf) || huf < 0 || !isLevel(level)) {
    return {
      kind: "invalid-input", intervalLabel: "", level: 1,
      ersattningExclVat: 0, gransvardeExclVat: 0,
      notes: ["Ogiltigt input. HUF-minuter måste vara ≥ 0 och nivå 1-4."],
    };
  }

  if (huf > TAXA_MAX_MINUTES) {
    return {
      kind: "exceeds-max", intervalLabel: "", level,
      ersattningExclVat: 0, gransvardeExclVat: 0,
      notes: [
        `Förhandlingstiden överstiger taxans maxgräns (${TAXA_MAX_MINUTES} min = 3 tim 45 min).`,
        "Taxan tillämpas inte — ersättning beräknas enligt timkostnadsnorm × faktisk tid.",
      ],
    };
  }

  const row = BROTTMALSTAXA_TABLE.find((r) => huf >= r.fromMin && huf <= r.toMin);
  if (!row) {
    // Inte väntat men defensiv
    return {
      kind: "invalid-input", intervalLabel: "", level,
      ersattningExclVat: 0, gransvardeExclVat: 0,
      notes: ["Hittade inget matchande intervall i tabellen."],
    };
  }

  const idx = level - 1;
  const e = row.ersattning[idx];
  const g = row.gransvarde[idx];
  if (e === undefined || g === undefined) {
    // Inte väntat — idx härleds ur validerad nivå (1-4), men defensiv
    return {
      kind: "invalid-input", intervalLabel: "", level,
      ersattningExclVat: 0, gransvardeExclVat: 0,
      notes: ["Hittade ingen taxa-rad för angiven nivå."],
    };
  }

  const ersattning = hasFTax ? e : applyNoFTaxFactor(e);
  const gransvarde = hasFTax ? g : applyNoFTaxFactor(g);

  const notes: string[] = [];
  if (!hasFTax) notes.push("Justerat för advokat utan F-skatt (× 1237/1626).");
  notes.push("Belopp exkl moms. För advokat med F-skatt lägger Domstolsverket 25 % moms ovanpå.");
  if (huf > row.toMin - 5) {
    notes.push("Nära intervallets övre gräns — verifiera faktiskt avslutsklockslag.");
  }

  return {
    kind: "taxa-applies",
    intervalLabel: row.label,
    level,
    ersattningExclVat: ersattning,
    gransvardeExclVat: gransvarde,
    notes,
  };
}

/** Justera ett ersättningsbelopp för advokat utan F-skatt. */
export function applyNoFTaxFactor(ersattningOre: number): number {
  return Math.round((ersattningOre * NO_FTAX_FACTOR_NUMERATOR) / NO_FTAX_FACTOR_DENOMINATOR);
}

function isLevel(v: unknown): v is TaxaLevel {
  return v === 1 || v === 2 || v === 3 || v === 4;
}
