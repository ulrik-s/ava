/**
 * Scenariomall för RÄTTSSKYDD (#880): klientbesök → rättsskyddsansökan → skriftväxling
 * med motpart/ombud → arbete/utlägg → aconto på självrisken → slutreglering mot
 * försäkringsbolaget (settleCoverage, FORSAKRING). Ingen kostnadsräkning (den vägen
 * gäller domstol/rättshjälp).
 */

import { partyEvents, STANDARD_PARTY_DAYS } from "../events";
import type { Parties, SimEvent } from "../events";

export function buildRattsskyddScenario(parties: Parties): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Klientbesök — genomgång av försäkringens rättsskydd." },
    { kind: "time", dayOffset: 0, minutes: 60, description: "Inledande genomgång och rättsskyddsansökan" },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
  ];
  ev.push(...partyEvents(parties, STANDARD_PARTY_DAYS));
  ev.push(
    { kind: "doc", dayOffset: 5, template: "brevTillOmbud" },
    { kind: "time", dayOffset: 12, minutes: 120, description: "Skriftväxling och förhandlingsförberedelse" },
    { kind: "expense", dayOffset: 14, amountOre: 90_000, description: "Ansökningsavgift tingsrätten", vatRate: 0, passThrough: true },
    { kind: "doc", dayOffset: 18, template: "brevFranOmbud" },
    { kind: "acconto", dayOffset: 30, clientShareBips: 2000 }, // 20 % självrisk
    { kind: "time", dayOffset: 45, minutes: 90, description: "Sammanträde och uppföljning" },
    { kind: "settle", dayOffset: 60, payerRecipient: "FORSAKRING" },
  );
  return ev;
}
