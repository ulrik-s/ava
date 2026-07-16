/**
 * Scenariovariant för RÄTTSSKYDD med POSITIVT försäkringsbesked (#899, ärende
 * 2026-0021). Normalflödet: klientbesök → ansökan om rättsskydd → försäkringsbolaget
 * BEVILJAR ("ersätter högst 100 tim arvode; självrisk 20 %, dock lägst 1 800 kr") →
 * arbete → slutreglering mot försäkringen. Vid slutregleringen betalar klienten
 * självrisken (golvet 1 800 kr slår in när 20 % av arvodet är lägre) och försäkringen
 * resten. Ingen kostnadsräkning (den vägen gäller domstol/rättshjälp).
 *
 * Matterns fält (seed): clientShareBips 2000 (20 %), rattsskyddSjalvriskMinOre 180000
 * (1 800 kr), rattsskyddMaxOre ~100 tim. Arbetet hålls litet så självrisks-golvet syns.
 */

import type { Parties, SimEvent } from "../events";

export function buildRattsskyddPositivtScenario(parties: Parties): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Klientbesök — genomgång av tvisten och hemförsäkringens rättsskydd." },
    { kind: "time", dayOffset: 0, minutes: 60, description: "Inledande genomgång och rådgivning" },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
    { kind: "doc", dayOffset: 2, template: "rattsskyddsansokan" },
    { kind: "note", dayOffset: 2, text: "Ansökan om rättsskydd inskickad till försäkringsbolaget." },
  ];
  if (parties.klient) ev.push({ kind: "party", dayOffset: 0, contactId: parties.klient, role: "KLIENT" });
  if (parties.motpart) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpart, role: "MOTPART" });
  if (parties.motpartsombud) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpartsombud, role: "MOTPARTSOMBUD" });
  if (parties.domstol) ev.push({ kind: "party", dayOffset: 2, contactId: parties.domstol, role: "DOMSTOL" });
  ev.push(
    { kind: "doc", dayOffset: 10, template: "rattsskyddBeslutPositivt" },
    { kind: "note", dayOffset: 10, text: "Rättsskydd beviljat: högst 100 tim arvode, självrisk 20 % dock lägst 1 800 kr." },
    { kind: "expense", dayOffset: 14, amountOre: 90_000, description: "Ansökningsavgift tingsrätten" },
    { kind: "time", dayOffset: 15, minutes: 90, description: "Skriftväxling och kravbrev till motpart" },
    { kind: "doc", dayOffset: 18, template: "brevTillOmbud" },
    { kind: "note", dayOffset: 30, text: "Förlikning nådd — tvisten avslutas utan huvudförhandling." },
    { kind: "time", dayOffset: 30, minutes: 90, description: "Förlikningsförhandling och överenskommelse" },
    // Slutreglering mot försäkringen: klienten betalar självrisken (golvet 1 800 kr),
    // försäkringen resten. Klienten har inte betalat aconto → självrisken blir slutfakturan.
    { kind: "settle", dayOffset: 45, payerRecipient: "FORSAKRING" },
  );
  return ev;
}
