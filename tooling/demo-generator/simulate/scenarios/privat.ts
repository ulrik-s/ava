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

import { partyEvents } from "../events";
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

/**
 * Upparbetat men ofakturerat arbete (#824) — arbete som tillkommit EFTER
 * senaste faktureringen och som ännu inte fakturerats.
 *
 * Låg förr i `populate-unbilled-time.ts`, som slutade kallas när den
 * kronologiska simuleringen tog över (#880/#882). Ingen märkte det, för
 * ingenting kraschar: fakturapanelen visade bara "Upparbetat ofakturerat:
 * 0 kr" på vartenda ärende i demon, och det fanns aldrig något att skapa
 * faktura ur — samma sorts tysta förlust som avbetalningsplanerna i #982.
 *
 * Dagarna ligger efter slutfakturan (30) och dess livscykel (44). `eventIso`
 * klampar mot i dag, så posterna landar färska även i unga ärenden.
 */
const FRESH_UNBILLED: ReadonlyArray<{ dayOffset: number; minutes: number; description: string }> = [
  { dayOffset: 50, minutes: 45, description: "Klientmöte (uppdatering)" },
  { dayOffset: 55, minutes: 90, description: "Granskning inkommande material" },
];

/**
 * `active` = ärendet är öppet i seeden. Bara då läggs ofakturerat arbete på:
 * upparbetad tid på ett avslutat ärende vore inte demodata utan en bugg —
 * det finns ingen väg att fakturera den.
 */
export function buildPrivatScenario(parties: Parties, index: number, active = false): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Nytt uppdrag — inledande klientmöte och uppdragsbekräftelse." },
    { kind: "time", dayOffset: 0, minutes: 90, description: "Inledande rådgivning och uppdragsbekräftelse" },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
  ];
  ev.push(...partyEvents(parties, { klient: 0, motpart: 2, motpartsombud: 2, domstol: 3 }));
  ev.push(
    { kind: "doc", dayOffset: 4, template: parties.domstol ? "stamningsansokan" : "brevTillOmbud" },
    { kind: "time", dayOffset: 10, minutes: 120, description: "Utredning och skriftväxling" },
    { kind: "expense", dayOffset: 12, amountOre: 45_000, description: "Registerutdrag och kopior" },
    { kind: "doc", dayOffset: 16, template: "brevFranOmbud" },
    { kind: "time", dayOffset: 24, minutes: 90, description: "Förhandling och uppföljning" },
    { kind: "final", dayOffset: 30, recipient: "KLIENT" },
  );
  ev.push(...(LIFECYCLES[index % LIFECYCLES.length] ?? LIFECYCLES[0]!)(44));
  if (active) ev.push(...FRESH_UNBILLED.map((w) => ({ kind: "time" as const, ...w })));
  return ev;
}
