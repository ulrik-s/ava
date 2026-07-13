/**
 * Scenariomall för PRIVAT (#880): uppdrag → löpande arbete/utlägg/dokument →
 * slutfaktura till klienten → (oftast) betalning. Variation ur `index` så demon
 * får både betalda och obetalda slutfakturor.
 */

import type { Parties, SimEvent } from "../events";

export function buildPrivatScenario(parties: Parties, index: number): SimEvent[] {
  const ev: SimEvent[] = [
    { kind: "note", dayOffset: 0, text: "Nytt uppdrag — inledande klientmöte och uppdragsbekräftelse." },
    { kind: "time", dayOffset: 0, minutes: 90, description: "Inledande rådgivning och uppdragsbekräftelse" },
    { kind: "doc", dayOffset: 1, template: "fullmakt" },
  ];
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
  // ~2 av 3 slutfakturor betalas; resten lämnas utestående (varierad demo).
  if (index % 3 !== 2) ev.push({ kind: "payment", dayOffset: 44 });
  return ev;
}
