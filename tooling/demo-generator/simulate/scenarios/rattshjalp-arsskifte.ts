/**
 * Scenariovariant för RÄTTSHJÄLP som spänner över ett ÅRSSKIFTE (#891, ärende
 * 2026-0020). Ärendet börjar i november 2025 (timkostnadsnorm 1 602 kr, tidsspillan
 * 1 450 kr) och sträcker sig fram till nu (2026, norm 1 626 kr). Vid slutregleringen
 * får ärendet en RETROAKTIV HÖJNING: HELA ärendet räknas om på 2026 års normer
 * (även 2025-timmarna), och skillnaden mot de aconton som ställdes ut på 2025-taxan
 * regleras på slutfakturorna till klient + domstol.
 *
 * Behåller den varierande rättshjälpsavgiften (arbetslös 5 % → anställd 40 % →
 * arbetslös 5 %, `rateChange`) OCH innehåller tidsspillan (egen, lägre norm).
 * Dag 0 ≈ nov 2025; årsgränsen (31 dec 2025) infaller runt dag 60.
 */

import type { Parties, SimEvent } from "../events";

export function buildRattshjalpArsskifteScenario(parties: Parties): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Klientbesök nov 2025 — första möte. Rådgivning enligt rättshjälpstaxan (2025 års norm 1 602 kr)." },
    { kind: "rateChange", dayOffset: 0, clientShareBips: 500 }, // klient arbetslös → 5 %
    { kind: "radgivning", dayOffset: 0 },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
  ];
  if (parties.klient) ev.push({ kind: "party", dayOffset: 0, contactId: parties.klient, role: "KLIENT" });
  if (parties.motpart) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpart, role: "MOTPART" });
  if (parties.motpartsombud) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpartsombud, role: "MOTPARTSOMBUD" });
  if (parties.domstol) ev.push({ kind: "party", dayOffset: 2, contactId: parties.domstol, role: "DOMSTOL" });

  ev.push(
    { kind: "expense", dayOffset: 8, amountOre: 90_000, description: "Ansökningsavgift tingsrätten" },
    // ── Period 1: arbetslös 5 %, HELA i 2025 (norm 1 602 / tidsspillan 1 450) ──
    { kind: "time", dayOffset: 6, minutes: 240, description: "Genomgång av handlingar och underlag" },
    { kind: "doc", dayOffset: 14, template: "svaromal" },
    { kind: "note", dayOffset: 14, text: "Svaromål inkommet från motpartsombudet." },
    { kind: "time", dayOffset: 16, minutes: 240, description: "Analys av svaromål och förhandlingsförberedelse" },
    { kind: "time", dayOffset: 28, minutes: 180, description: "Restid och väntetid — sammanträde i Göteborg", entryKind: "TIDSSPILLAN" },
    { kind: "time", dayOffset: 35, minutes: 240, description: "Utkast till inlaga och yttrande" },
    { kind: "doc", dayOffset: 36, template: "inlaga" },
    { kind: "time", dayOffset: 45, minutes: 240, description: "Korrespondens med motpartsombud" },
    { kind: "time", dayOffset: 55, minutes: 240, description: "Fördjupad rättsutredning" }, // → aconto #1 (5 %, 2025-taxa)
    // ── Årsskifte passeras (~dag 60) → 2026 års normer gäller nya poster ──
    { kind: "note", dayOffset: 75, text: "Klienten har fått anställning — rättshjälpsavgiften höjs till 40 % (jan 2026)." },
    { kind: "rateChange", dayOffset: 75, clientShareBips: 4000 },
    // ── Period 2: anställd 40 %, 2026 (norm 1 626) ──
    { kind: "time", dayOffset: 85, minutes: 150, description: "Sammanträde i tingsrätten" }, // → aconto #2 (40 %, 2026-taxa)
    { kind: "note", dayOffset: 150, text: "Klienten åter arbetslös — avgiften tillbaka till 5 %." },
    { kind: "rateChange", dayOffset: 150, clientShareBips: 500 },
    // ── Period 3: arbetslös 5 %, 2026 ──
    { kind: "time", dayOffset: 160, minutes: 240, description: "Uppföljning efter sammanträde" },
    { kind: "time", dayOffset: 175, minutes: 120, description: "Restid — möte med klient och socialtjänst", entryKind: "TIDSSPILLAN" },
    { kind: "time", dayOffset: 185, minutes: 240, description: "Komplettering och inlaga" },
    { kind: "time", dayOffset: 200, minutes: 240, description: "Korrespondens och bevisgenomgång" },
    { kind: "time", dayOffset: 215, minutes: 240, description: "Förberedelse inför slutförhandling" },
    { kind: "time", dayOffset: 225, minutes: 240, description: "Slutlig genomgång av ärendet" }, // → aconto #3 (5 %, 2026-taxa)
    // ── Kostnadsräkning → beslut → slutreglering (retroaktiv höjning till 2026 års norm) ──
    { kind: "kostnadsrakning", dayOffset: 235 },
    { kind: "doc", dayOffset: 236, template: "beslutRattshjalp" },
    { kind: "beslut", dayOffset: 238 },
    { kind: "settle", dayOffset: 245, payerRecipient: "DOMSTOL" },
  );
  return ev;
}
