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
}

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
