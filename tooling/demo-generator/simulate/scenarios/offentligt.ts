/**
 * Scenariomall för OFFENTLIGT_UPPDRAG (brottmål, #880): förordnande → genomgång av
 * förundersökning → klientmöte + huvudförhandling → kostnadsräkning till domstol →
 * domstolens beslut → domstolsfaktura (setVerdict). Taxa vs frångång styrs av
 * matterns fält; flödet (KR → beslut → verdict) är detsamma.
 */

import type { Parties, SimEvent } from "../events";

export function buildOffentligtScenario(parties: Parties): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Förordnad som offentlig försvarare." },
    { kind: "time", dayOffset: 1, minutes: 120, description: "Genomgång av förundersökningsprotokoll" },
  ];
  if (parties.domstol) ev.push({ kind: "party", dayOffset: 2, contactId: parties.domstol, role: "DOMSTOL" });
  ev.push(
    { kind: "doc", dayOffset: 4, template: "brevTillOmbud" },
    { kind: "time", dayOffset: 12, minutes: 180, description: "Klientmöte + förberedelse inför huvudförhandling" },
    { kind: "time", dayOffset: 20, minutes: 120, description: "Huvudförhandling i tingsrätten" },
    { kind: "kostnadsrakning", dayOffset: 22 },
    { kind: "beslut", dayOffset: 30 },
    { kind: "doc", dayOffset: 31, template: "dom" },
    { kind: "verdict", dayOffset: 32 },
  );
  return ev;
}
