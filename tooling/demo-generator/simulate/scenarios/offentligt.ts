/**
 * Scenariomall för OFFENTLIGT_UPPDRAG (brottmål, #880): förordnande → genomgång av
 * förundersökning → klientmöte + huvudförhandling → kostnadsräkning till domstol →
 * domstolens beslut → domstolsfaktura (setVerdict). Taxa vs frångång styrs av
 * matterns fält; flödet (KR → beslut → verdict) är detsamma.
 */

import type { Parties, SimEvent } from "../events";

export interface OffentligtOpts {
  /**
   * Stanna EFTER kostnadsräkningen: ingen `beslut`, ingen `verdict`. Ärendet
   * blir kvar i "kostnadsräkning väntar på dom" — fakturapanelens tillstånd
   * mellan inlämnad KR och domstolens beslut (#882).
   *
   * Utan detta får varje offentligt uppdrag beslut samma vecka och demon visar
   * aldrig väntetillståndet, trots att panelen har en egen vy för det. Det låg
   * förr i `populate-billing.ts`; simuleringen tog aldrig över det.
   */
  awaitVerdict?: boolean;
}

export function buildOffentligtScenario(parties: Parties, opts: OffentligtOpts = {}): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Förordnad som offentlig försvarare." },
    { kind: "time", dayOffset: 1, minutes: 120, description: "Genomgång av förundersökningsprotokoll" },
  ];
  if (parties.klient) ev.push({ kind: "party", dayOffset: 0, contactId: parties.klient, role: "KLIENT" });
  if (parties.domstol) ev.push({ kind: "party", dayOffset: 2, contactId: parties.domstol, role: "DOMSTOL" });
  ev.push(
    { kind: "expense", dayOffset: 6, amountOre: 38_000, description: "Reskostnad häktesbesök" },
    { kind: "doc", dayOffset: 4, template: "brevTillOmbud" },
    { kind: "time", dayOffset: 12, minutes: 180, description: "Klientmöte + förberedelse inför huvudförhandling" },
    { kind: "time", dayOffset: 20, minutes: 120, description: "Huvudförhandling i tingsrätten" },
    { kind: "kostnadsrakning", dayOffset: 22 },
  );
  if (opts.awaitVerdict) return ev;
  ev.push(
    { kind: "beslut", dayOffset: 30 },
    { kind: "doc", dayOffset: 31, template: "dom" },
    { kind: "verdict", dayOffset: 32 },
  );
  return ev;
}
