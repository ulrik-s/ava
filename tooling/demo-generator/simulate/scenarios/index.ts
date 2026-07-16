/**
 * Scenario-dispatcher (#880): väljer kronologisk mall efter ärendets betalningssätt.
 */

import type { Parties, SimEvent, SimMatter } from "../events";
import { buildOffentligtScenario } from "./offentligt";
import { buildPrivatScenario } from "./privat";
import { buildRattshjalpScenario } from "./rattshjalp";
import { buildRattshjalpArsskifteScenario } from "./rattshjalp-arsskifte";
import { buildRattsskyddScenario } from "./rattsskydd";
import { buildRattsskyddPositivtScenario } from "./rattsskydd-positivt";

export function buildScenario(matter: SimMatter, parties: Parties, index: number): SimEvent[] {
  switch (matter.paymentMethod) {
    // 2026-0020 spänner över ett årsskifte + tidsspillan + retroaktiv höjning (#891).
    case "RATTSHJALP": return matter.matterNumber === "2026-0020"
      ? buildRattshjalpArsskifteScenario(parties)
      : buildRattshjalpScenario(parties);
    // 2026-0021 = positivt rättsskyddsbesked (100 tim, självrisk 20 % lägst 1 800 kr, #899).
    case "RATTSSKYDD": return matter.matterNumber === "2026-0021"
      ? buildRattsskyddPositivtScenario(parties)
      : buildRattsskyddScenario(parties);
    case "OFFENTLIGT_UPPDRAG": return buildOffentligtScenario(parties);
    default: return buildPrivatScenario(parties, index);
  }
}
