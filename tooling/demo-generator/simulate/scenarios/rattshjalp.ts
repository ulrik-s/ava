/**
 * Scenariomall för RÄTTSHJÄLP (#880/#885) — kronologisk narrativ med VARIERANDE
 * självrisk-avgift (arbetslös 5 % → anställd 75 % → arbetslös 5 %). Aconto skickas
 * INTE på skriptade dagar utan TRÖSKELSTYRT (#885): runnern ackumulerar klientens
 * andel vid aktuell sats och fyr ett aconto FÖRST när den nått byråns gränsbelopp
 * (default 1500 kr). Satsbyten sker via `rateChange`; arbetsvolymen per period är
 * tilltagen så var period hinner passera tröskeln → de tre aconton (5/75/5 %) syns.
 * Avslutas med kostnadsräkning → beslut → slutreglering (→ kredit vid överfakturering).
 */

import type { Parties, SimEvent } from "../events";

export function buildRattshjalpScenario(parties: Parties): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Klientbesök — första möte i ärendet. Rådgivning enligt rättshjälpstaxan." },
    { kind: "rateChange", dayOffset: 0, clientShareBips: 500 }, // klient arbetslös → 5 %
    // Rådgivningstimmen skapas + faktureras SAMMA DAG som mötet (#880); allt arbete EFTER
    // detta går på aconto. (hRadgivning skapar tidsposten + rådgivningsfakturan.)
    { kind: "radgivning", dayOffset: 0 },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
  ];
  if (parties.motpart) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpart, role: "MOTPART" });
  if (parties.motpartsombud) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpartsombud, role: "MOTPARTSOMBUD" });
  if (parties.domstol) ev.push({ kind: "party", dayOffset: 2, contactId: parties.domstol, role: "DOMSTOL" });

  ev.push(
    // Period 1 (arbetslös, 5 %) — löpande arbete tills klientens andel når tröskeln (→ aconto).
    { kind: "time", dayOffset: 6, minutes: 240, description: "Genomgång av handlingar och underlag" },
    { kind: "doc", dayOffset: 7, template: "brevTillOmbud" },
    { kind: "doc", dayOffset: 14, template: "svaromal" },
    { kind: "note", dayOffset: 14, text: "Svaromål inkommet från motpartsombudet." },
    { kind: "time", dayOffset: 14, minutes: 240, description: "Analys av svaromål och förhandlingsförberedelse" },
    { kind: "time", dayOffset: 22, minutes: 240, description: "Utkast till inlaga och yttrande" },
    { kind: "doc", dayOffset: 23, template: "inlaga" },
    { kind: "time", dayOffset: 30, minutes: 240, description: "Korrespondens med motpartsombud" },
    { kind: "time", dayOffset: 38, minutes: 240, description: "Fördjupad rättsutredning" }, // → aconto #1 (5 %)
    { kind: "note", dayOffset: 45, text: "Klienten har fått anställning — rättshjälpsavgiften höjs till 75 %." },
    // Period 2 (anställd, 75 %) — en insats räcker för att passera tröskeln (överfakturerar
    // mot slutligt beslut → kredit vid slutreglering).
    { kind: "rateChange", dayOffset: 45, clientShareBips: 7500 },
    { kind: "time", dayOffset: 50, minutes: 150, description: "Sammanträde i tingsrätten" }, // → aconto #2 (75 %)
    { kind: "note", dayOffset: 85, text: "Klienten åter arbetslös — avgiften tillbaka till 5 %." },
    // Period 3 (arbetslös, 5 %) — löpande arbete tills tröskeln nås igen.
    { kind: "rateChange", dayOffset: 85, clientShareBips: 500 },
    { kind: "time", dayOffset: 88, minutes: 240, description: "Uppföljning efter sammanträde" },
    { kind: "time", dayOffset: 92, minutes: 240, description: "Komplettering och inlaga" },
    { kind: "time", dayOffset: 96, minutes: 240, description: "Korrespondens och bevisgenomgång" },
    { kind: "time", dayOffset: 100, minutes: 240, description: "Förberedelse inför slutförhandling" },
    { kind: "time", dayOffset: 103, minutes: 240, description: "Slutlig genomgång av ärendet" }, // → aconto #3 (5 %)
    // Kostnadsräkning → myndighetens/domstolens beslut → slutreglering.
    { kind: "kostnadsrakning", dayOffset: 105 },
    { kind: "doc", dayOffset: 106, template: "beslutRattshjalp" },
    { kind: "beslut", dayOffset: 107 },
    { kind: "settle", dayOffset: 110, payerRecipient: "DOMSTOL" },
  );
  return ev;
}
