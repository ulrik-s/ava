/**
 * Scenario-dispatcher (#880): väljer kronologisk mall efter ärendets betalningssätt.
 */

import type { Parties, SimEvent, SimMatter } from "../events";
import { buildOffentligtScenario } from "./offentligt";
import { buildPrivatScenario } from "./privat";
import { buildRattshjalpScenario } from "./rattshjalp";
import { buildRattsskyddScenario } from "./rattsskydd";

export function buildScenario(matter: SimMatter, parties: Parties, index: number): SimEvent[] {
  switch (matter.paymentMethod) {
    case "RATTSHJALP": return buildRattshjalpScenario(parties);
    case "RATTSSKYDD": return buildRattsskyddScenario(parties);
    case "OFFENTLIGT_UPPDRAG": return buildOffentligtScenario(parties);
    default: return buildPrivatScenario(parties, index);
  }
}
