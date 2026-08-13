/**
 * Scenariomall för OFFENTLIGT_UPPDRAG (brottmål, #880): förordnande → genomgång av
 * förundersökning → klientmöte + huvudförhandling → kostnadsräkning till domstol →
 * domstolens beslut → domstolsfaktura (setVerdict). Taxa vs frångång styrs av
 * matterns fält; flödet (KR → beslut → verdict) är detsamma.
 *
 * Kostnadsräkningens livscykel (#828) har fyra tillstånd, och demon ska visa dem
 * alla SAMTIDIGT — annars går de bara att nå genom att själv klicka sig framåt,
 * och panelens vyer för dem syns aldrig i en färsk demo. Därför `stopAfter`:
 * varje brottmål vilar på sin punkt i kedjan.
 */

import { partyEvents } from "../events";
import type { Parties, SimEvent } from "../events";

/**
 * Var scenariot ska STANNA — vilket KR-tillstånd ärendet vilar i (#828 steg 6).
 *
 * | värde | KR-status | vad panelen visar |
 * |---|---|---|
 * | `kostnadsrakning` | INSKICKAD | "Väntar på dom" + "Registrera beslut" |
 * | `beslut` | BESLUTAD | "Skapa faktura" + "Överklaga prutning" |
 * | `overklaga` | ÖVERKLAGAD | "Registrera hovrättens beslut" |
 * | *(utelämnad)* | FAKTURERAD | domstolsfakturan med sitt dokument |
 */
export type OffentligtStop = "kostnadsrakning" | "beslut" | "overklaga";

export interface OffentligtOpts {
  stopAfter?: OffentligtStop;
  /**
   * Domstolens nedsättning av det yrkade beloppet (bips). Registreras som
   * prutning PÅ kostnadsräkningen — det är den som gör ett överklagande
   * begripligt: man överklagar prutningen, inte beslutet i stort.
   */
  reducedByBips?: number;
  /**
   * Lägg till de kategorier som annars inte förekommer på ett brottmål —
   * tidsspillan dag/annan tid — plus ett utlägg med en ANNAN momssats (#950
   * steg 4). Ett ärende ska visa hela kategoribredden tillsammans med en
   * prutning, så att sammanställningen går att granska rad för rad.
   */
  allCategories?: boolean;
}

/**
 * Kategorierna som saknas i grundmallen (#950 steg 4). Tidsspillan har två
 * nivåer med olika årsnormer — 1 487 kr/h vardag 08–18 och 975 kr/h annan tid
 * (DVFS 2025:4 § 4) — och utlägget bär 6 % moms så specifikationen får mer än
 * en momssats att summera.
 */
const FULL_SPREAD: readonly SimEvent[] = [
  { kind: "time", dayOffset: 18, minutes: 120, description: "Restid till häktet — vardag dagtid", entryKind: "TIDSSPILLAN" },
  { kind: "time", dayOffset: 19, minutes: 90, description: "Väntetid inför förhandling — kvällstid", entryKind: "TIDSSPILLAN_OVRIG_TID" },
  { kind: "expense", dayOffset: 19, amountOre: 24_000, description: "Tågbiljett till häktet", vatRate: 600 },
];

export function buildOffentligtScenario(parties: Parties, opts: OffentligtOpts = {}): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Förordnad som offentlig försvarare." },
    { kind: "time", dayOffset: 1, minutes: 120, description: "Genomgång av förundersökningsprotokoll" },
  ];
  ev.push(...partyEvents(parties, { klient: 0, domstol: 2 }));
  ev.push(
    { kind: "expense", dayOffset: 6, amountOre: 38_000, description: "Reskostnad häktesbesök" },
    { kind: "doc", dayOffset: 4, template: "brevTillOmbud" },
    { kind: "time", dayOffset: 12, minutes: 180, description: "Klientmöte + förberedelse inför huvudförhandling" },
    { kind: "time", dayOffset: 20, minutes: 120, description: "Huvudförhandling i tingsrätten" },
    // Advokatberedskap (#950, DVFS 2025:9): två beredskapsdygn, varav det ena
    // "förbrukas" av en häktningsförhandling — då utgår arbetet i stället för
    // garantin (§ 2). Demon visar båda utfallen på samma ärende; annars syns
    // regeln bara i koden.
    { kind: "time", dayOffset: 14, minutes: 0, description: "Advokatberedskap — helgjour tingsrätten", entryKind: "ADVOKATBEREDSKAP" },
    { kind: "time", dayOffset: 15, minutes: 0, description: "Advokatberedskap — helgjour tingsrätten", entryKind: "ADVOKATBEREDSKAP" },
    { kind: "time", dayOffset: 15, minutes: 90, description: "Häktningsförhandling under helg", entryKind: "ARBETE_OBEKVAM_TID" },
    ...(opts.allCategories ? FULL_SPREAD : []),
    { kind: "kostnadsrakning", dayOffset: 22 },
  );
  if (opts.stopAfter === "kostnadsrakning") return ev;

  ev.push({
    kind: "beslut", dayOffset: 30,
    ...(opts.reducedByBips ? { reducedByBips: opts.reducedByBips } : {}),
  });
  // Nedsättningen kommer med ett beslut i akten — annars visar panelen en
  // prutning som ingen handling förklarar.
  if (opts.reducedByBips) ev.push({ kind: "doc", dayOffset: 30, template: "arvodesbeslut" });
  if (opts.stopAfter === "beslut") return ev;

  if (opts.stopAfter === "overklaga") {
    ev.push(
      { kind: "note", dayOffset: 33, text: "Tingsrättens nedsättning av arvodet överklagas till hovrätten." },
      { kind: "doc", dayOffset: 33, template: "overklagandeInlaga" },
      { kind: "overklaga", dayOffset: 33 },
    );
    return ev;
  }

  ev.push(
    { kind: "doc", dayOffset: 31, template: "dom" },
    { kind: "verdict", dayOffset: 32 },
  );
  return ev;
}
