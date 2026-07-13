/**
 * Scenariomall för RÄTTSHJÄLP (#880) — kronologisk narrativ som subsumerar den
 * tidigare m-020-varierande-sats-flödet: klientbesök + rådgivningstimme → fakturera
 * → länka motpart/ombud → inkommande svaromål → löpande arbete → aconton vid
 * VARIERANDE avgift (arbetslös 5 % → anställd 75 % → arbetslös 5 %) → kostnadsräkning
 * → beslut → slutreglering (→ kreditfaktura vid överfakturering, jfr #878).
 */

import type { SimEvent } from "../events";

export interface Parties {
  motpart?: string | undefined;
  motpartsombud?: string | undefined;
  domstol?: string | undefined;
}

export function buildRattshjalpScenario(parties: Parties): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Klientbesök — första möte i ärendet. Rådgivning enligt rättshjälpstaxan." },
    { kind: "time", dayOffset: 0, minutes: 60, description: "Första möte med klient (rådgivning)" },
    { kind: "radgivning", dayOffset: 1 },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
  ];
  if (parties.motpart) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpart, role: "MOTPART" });
  if (parties.motpartsombud) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpartsombud, role: "MOTPARTSOMBUD" });
  if (parties.domstol) ev.push({ kind: "party", dayOffset: 2, contactId: parties.domstol, role: "DOMSTOL" });

  ev.push(
    { kind: "time", dayOffset: 6, minutes: 90, description: "Genomgång av handlingar (klient arbetslös, 5 % avgift)" },
    { kind: "doc", dayOffset: 7, template: "brevTillOmbud" },
    { kind: "doc", dayOffset: 14, template: "svaromal" },
    { kind: "note", dayOffset: 14, text: "Svaromål inkommet från motpartsombudet." },
    // Period 1 (arbetslös, 5 %) → aconto på upparbetat.
    { kind: "acconto", dayOffset: 20, clientShareBips: 500 },
    { kind: "time", dayOffset: 40, minutes: 120, description: "Förhandlingsförberedelse och inlaga" },
    { kind: "doc", dayOffset: 41, template: "inlaga" },
    { kind: "note", dayOffset: 45, text: "Klienten har fått anställning — rättshjälpsavgiften höjs till 75 %." },
    // Period 2 (anställd, 75 %) → aconto (överfakturerar mot slutligt beslut).
    { kind: "acconto", dayOffset: 55, clientShareBips: 7500 },
    { kind: "time", dayOffset: 70, minutes: 120, description: "Sammanträde i tingsrätten" },
    { kind: "note", dayOffset: 85, text: "Klienten åter arbetslös — avgiften tillbaka till 5 %." },
    // Period 3 (arbetslös, 5 %).
    { kind: "acconto", dayOffset: 90, clientShareBips: 500 },
    { kind: "time", dayOffset: 100, minutes: 90, description: "Uppföljning och korrespondens" },
    // Kostnadsräkning → myndighetens/domstolens beslut → slutreglering.
    { kind: "kostnadsrakning", dayOffset: 105 },
    { kind: "doc", dayOffset: 106, template: "beslutRattshjalp" },
    { kind: "beslut", dayOffset: 107 },
    { kind: "settle", dayOffset: 110, payerRecipient: "DOMSTOL" },
  );
  return ev;
}
