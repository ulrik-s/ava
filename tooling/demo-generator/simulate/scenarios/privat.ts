/**
 * Scenariomall för PRIVAT (#880): uppdrag → löpande arbete/utlägg/dokument →
 * slutfaktura till klienten → en av fakturans livscykler.
 *
 * Livscyklerna (#982) fanns förr i `populate-billing.ts`, som slutade kallas när
 * den kronologiska simuleringen tog över (#880). Fakturering och tid följde med;
 * avbetalningsplanerna och avskrivningarna gjorde det inte, så `/payment-plans`
 * stod tom i demon och avskrivningsvägen visades aldrig — trots att
 * `computeInvoiceLedger` räknar med båda.
 */

import type { Parties, SimEvent } from "../events";

/**
 * Slutfakturans livscykler, en per variant-index. Cykeln är sex lång och
 * ordningen är avsiktlig: med sex eller fler privatärenden förekommer VARJE
 * tillstånd minst en gång, så demon visar betald, utestående, alla tre
 * plan-tillstånden och en kundförlust utan att något behöver slumpas.
 */
const LIFECYCLES: ReadonlyArray<(day: number) => SimEvent[]> = [
  // Betald i sin helhet.
  (d) => [{ kind: "payment", dayOffset: d }],
  // Utestående — ingen händelse alls efter fakturan.
  () => [],
  // ACTIVE plan: 5 poster, 2 betalda, påminnelser utskickade.
  (d) => [{ kind: "paymentPlan", dayOffset: d, installments: 5, paidInstallments: 2, reminders: 2 }],
  // COMPLETED plan: alla poster betalda → sista betalningen stänger fakturan.
  (d) => [{ kind: "paymentPlan", dayOffset: d, installments: 3, paidInstallments: 3, dayOfMonth: 1, reminders: 3 }],
  // CANCELLED plan: avbruten utan inbetalningar → fakturan tillbaka som SENT.
  (d) => [{ kind: "paymentPlan", dayOffset: d, installments: 6, paidInstallments: 0, dayOfMonth: 28, cancel: true, notes: "Avbruten på klientens begäran" }],
  // Kundförlust (ADR 0007): delbetalning, resten avskriven.
  (d) => [{ kind: "writeOff", dayOffset: d, partialBips: 2500 }],
];

export function buildPrivatScenario(parties: Parties, index: number): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Nytt uppdrag — inledande klientmöte och uppdragsbekräftelse." },
    { kind: "time", dayOffset: 0, minutes: 90, description: "Inledande rådgivning och uppdragsbekräftelse" },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
  ];
  if (parties.klient) ev.push({ kind: "party", dayOffset: 0, contactId: parties.klient, role: "KLIENT" });
  if (parties.motpart) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpart, role: "MOTPART" });
  if (parties.motpartsombud) ev.push({ kind: "party", dayOffset: 2, contactId: parties.motpartsombud, role: "MOTPARTSOMBUD" });
  if (parties.domstol) ev.push({ kind: "party", dayOffset: 3, contactId: parties.domstol, role: "DOMSTOL" });
  ev.push(
    { kind: "doc", dayOffset: 4, template: parties.domstol ? "stamningsansokan" : "brevTillOmbud" },
    { kind: "time", dayOffset: 10, minutes: 120, description: "Utredning och skriftväxling" },
    { kind: "expense", dayOffset: 12, amountOre: 45_000, description: "Registerutdrag och kopior" },
    { kind: "doc", dayOffset: 16, template: "brevFranOmbud" },
    { kind: "time", dayOffset: 24, minutes: 90, description: "Förhandling och uppföljning" },
    { kind: "final", dayOffset: 30, recipient: "KLIENT" },
  );
  ev.push(...(LIFECYCLES[index % LIFECYCLES.length] ?? LIFECYCLES[0]!)(44));
  return ev;
}
