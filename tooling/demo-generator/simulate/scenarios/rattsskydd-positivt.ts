/**
 * Scenariovariant för RÄTTSSKYDD med POSITIVT försäkringsbesked (#899/#907, ärende
 * 2026-0021, Falks vårdnadstvist). Ett STÖRRE ärende som börjar nov 2025 och sträcker
 * sig över årsskiftet till nu. Flöde:
 *   1. Klientbesök → ansökan om rättsskydd → försäkringen BEVILJAR (100 tim, självrisk
 *      20 % dock lägst 1 800 kr).
 *   2. Löpande arbete → ACONTO-fakturor till KLIENTEN (på självrisken) — några i 2025,
 *      några i 2026 (olika datum).
 *   3. Slutreglering mot försäkringen → försäkringsfaktura (deras andel) + klientens
 *      slutliga självrisk (minus betalda aconton).
 *   4. Försäkringen PRUTAR efteråt → klienten bär mellanskillnaden (#905, flöde B).
 *
 * SKILLNAD mot rättshjälp: prutningen bärs av KLIENTEN (inte byrån). Rättsskydd
 * värderas på juristens timtaxa (ej timkostnadsnormen), så ingen retroaktiv taxa-
 * höjning över årsskiftet — men fakturorna får korrekta datum ur sina event (#907).
 */

import type { Parties, SimEvent } from "../events";

export function buildRattsskyddPositivtScenario(parties: Parties): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Klientbesök nov 2025 — genomgång av vårdnadstvisten och hemförsäkringens rättsskydd." },
    { kind: "time", dayOffset: 0, minutes: 90, description: "Inledande genomgång och rådgivning" },
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
    // ── Löpande arbete 2025 → aconto på självrisken (klienten) ──
    { kind: "time", dayOffset: 15, minutes: 240, description: "Skriftväxling och kravbrev till motpart" },
    { kind: "doc", dayOffset: 18, template: "brevTillOmbud" },
    { kind: "time", dayOffset: 30, minutes: 240, description: "Förhandlingsförberedelse och bevisgenomgång" },
    { kind: "time", dayOffset: 45, minutes: 240, description: "Utredning av vårdnadsfrågan" },
    { kind: "acconto", dayOffset: 50, clientShareBips: 2000 }, // aconto #1 självrisk (dec 2025)
    // ── Årsskiftet passeras (~dag 60) ──
    { kind: "time", dayOffset: 90, minutes: 240, description: "Sammanträde och yttrande" },
    { kind: "doc", dayOffset: 95, template: "inlaga" },
    { kind: "time", dayOffset: 120, minutes: 240, description: "Komplettering och korrespondens" },
    { kind: "acconto", dayOffset: 125, clientShareBips: 2000 }, // aconto #2 självrisk (mars 2026)
    // ── Slutskede — arbete som INTE hunnit acconteras (blir kvar på slutfakturan) ──
    { kind: "time", dayOffset: 160, minutes: 240, description: "Förberedelse inför slutförhandling" },
    { kind: "time", dayOffset: 190, minutes: 240, description: "Slutförhandling och överenskommelse" },
    { kind: "note", dayOffset: 200, text: "Förlikning nådd — tvisten avslutas." },
    // ── Slutreglering mot försäkringen: försäkringsfaktura + klientens slutliga självrisk ──
    { kind: "settle", dayOffset: 230, payerRecipient: "FORSAKRING" },
    // ── Flöde B (#905): försäkringen PRUTAR → klienten bär mellanskillnaden ──
    { kind: "note", dayOffset: 245, text: "Försäkringsbolaget prutar på arvodet — ersätter 3 000 kr mindre. Mellanskillnaden faktureras klienten." },
    { kind: "insurerPruning", dayOffset: 245, prunedNetOre: 300_000 },
  );
  return ev;
}
