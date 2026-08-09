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
 *   4. Försäkringen PRUTAR efteråt → beloppet omfördelas från försäkringsfakturan
 *      till klientfakturan; klienten bär mellanskillnaden (#905/#952, flöde B).
 *
 * SKILLNAD mot rättshjälp: prutningen bärs av KLIENTEN (inte byrån). Arvodet
 * värderas på samma rättshjälpstaxenivåer som rättshjälpen (#950/#953) — alla fyra
 * arvodeskategorierna förekommer här, och årsskiftet ger en RETROAKTIV höjning:
 * 2025-timmarna räknas om på 2026 års normer vid slutregleringen.
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
    // Utlägg med olika momssatser (#953) — sammanställningen visar utläggen både
    // exkl och inkl moms per sats. Ansökningsavgiften är momsfri.
    { kind: "expense", dayOffset: 14, amountOre: 90_000, description: "Ansökningsavgift tingsrätten", vatRate: 0, passThrough: true },
    // ── Löpande arbete 2025 → aconto på självrisken (klienten) ──
    { kind: "time", dayOffset: 15, minutes: 240, description: "Skriftväxling och kravbrev till motpart" },
    { kind: "doc", dayOffset: 18, template: "brevTillOmbud" },
    { kind: "expense", dayOffset: 29, amountOre: 36_000, description: "Tågresa till sammanträde", vatRate: 600 },
    { kind: "time", dayOffset: 30, minutes: 240, description: "Förhandlingsförberedelse och bevisgenomgång" },
    { kind: "time", dayOffset: 31, minutes: 150, description: "Restid och väntetid vid sammanträdet", entryKind: "TIDSSPILLAN" },
    { kind: "time", dayOffset: 45, minutes: 240, description: "Utredning av vårdnadsfrågan" },
    { kind: "acconto", dayOffset: 50, clientShareBips: 2000 }, // aconto #1 självrisk (dec 2025)
    // ── Årsskiftet passeras (~dag 60) ──
    { kind: "time", dayOffset: 90, minutes: 240, description: "Sammanträde och yttrande" },
    { kind: "doc", dayOffset: 95, template: "inlaga" },
    { kind: "time", dayOffset: 120, minutes: 240, description: "Komplettering och korrespondens" },
    { kind: "acconto", dayOffset: 125, clientShareBips: 2000 }, // aconto #2 självrisk (mars 2026)
    // ── Slutskede — arbete som INTE hunnit acconteras (blir kvar på slutfakturan) ──
    { kind: "time", dayOffset: 160, minutes: 240, description: "Förberedelse inför slutförhandling" },
    // Helgtaxan är ovanlig men gäller även i rättsskydd (DVFS 2025:7 § 1).
    { kind: "time", dayOffset: 168, minutes: 90, description: "Akut hantering av interimistiskt yrkande under helg", entryKind: "ARBETE_OBEKVAM_TID" },
    { kind: "expense", dayOffset: 189, amountOre: 64_000, description: "Hotellnatt före slutförhandlingen", vatRate: 1200 },
    { kind: "time", dayOffset: 190, minutes: 240, description: "Slutförhandling och överenskommelse" },
    { kind: "time", dayOffset: 190, minutes: 120, description: "Hemresa efter slutförhandlingen (kväll)", entryKind: "TIDSSPILLAN_OVRIG_TID" },
    { kind: "expense", dayOffset: 195, amountOre: 18_000, description: "Kopiering och porto", vatRate: 2500 },
    { kind: "note", dayOffset: 200, text: "Förlikning nådd — tvisten avslutas." },
    // ── Slutreglering mot försäkringen: försäkringsfaktura + klientens slutliga självrisk ──
    { kind: "settle", dayOffset: 230, payerRecipient: "FORSAKRING" },
    // ── Flöde B (#905): försäkringen PRUTAR → klienten bär mellanskillnaden ──
    { kind: "note", dayOffset: 245, text: "Försäkringsbolaget prutar på arvodet — ersätter 3 000 kr mindre. Beloppet flyttas till klientens faktura (ingen kreditfaktura till bolaget)." },
    { kind: "insurerPruning", dayOffset: 245, prunedNetOre: 300_000 },
  );
  return ev;
}
