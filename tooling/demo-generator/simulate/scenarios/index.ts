/**
 * Scenario-dispatcher (#880): väljer kronologisk mall efter ärendets betalningssätt.
 */

import type { Parties, SimEvent, SimMatter } from "../events";
import { buildOffentligtScenario, type OffentligtOpts } from "./offentligt";
import { buildPrivatScenario } from "./privat";
import { buildRattshjalpScenario } from "./rattshjalp";
import { buildRattshjalpArsskifteScenario } from "./rattshjalp-arsskifte";
import { buildRattsskyddScenario } from "./rattsskydd";
import { buildRattsskyddPositivtScenario } from "./rattsskydd-positivt";

/**
 * Var varje brottmål vilar i kostnadsräkningens livscykel (#828 steg 6). Ett
 * ärende per tillstånd, så demon visar alla fyra samtidigt i st.f. att bara
 * kunna nås genom att klicka sig framåt:
 *
 * - **2026-0017** INSKICKAD — väntar på dom (#882). `demo-kostnadsrakning-
 *   verdict.spec.ts` kör beslut → faktura härifrån, uppslaget ur seeden.
 * - **2026-0016** BESLUTAD — beslutat men ofakturerat, med en prutning att
 *   antingen acceptera (Skapa faktura) eller överklaga.
 * - **2026-0019** ÖVERKLAGAD — prutningen överklagad, väntar på hovrätten.
 * - **2026-0018** FAKTURERAD — hela kedjan gången; det ärende
 *   `demo-invoice-document.spec.ts` hämtar sitt fakturadokument ur.
 */
const OFFENTLIGT_STOPS: Record<string, OffentligtOpts> = {
  "2026-0016": { stopAfter: "beslut", reducedByBips: 1000 },
  "2026-0017": { stopAfter: "kostnadsrakning" },
  "2026-0019": { stopAfter: "overklaga", reducedByBips: 2500, allCategories: true },
};

function offentligtOpts(matterNumber: string | undefined): OffentligtOpts {
  return (matterNumber && OFFENTLIGT_STOPS[matterNumber]) || {};
}

export function buildScenario(matter: SimMatter, parties: Parties, index: number): SimEvent[] {
  switch (matter.paymentMethod) {
    // 2026-0020 spänner över ett årsskifte + tidsspillan + retroaktiv höjning (#891).
    // 2026-0010 visar domstolens PRUTNING (#936): 15 % nedsättning som BYRÅN bär.
    // Valt just det ärendet för att det OCKSÅ har en rättshjälpsavgift (40 %) → båda
    // avdragen syns på domstolsfakturan. Motstycket är rättsskyddets prutning i
    // 2026-0021, där KLIENTEN bär den.
    case "RATTSHJALP":
      if (matter.matterNumber === "2026-0020") return buildRattshjalpArsskifteScenario(parties);
      return buildRattshjalpScenario(parties, matter.matterNumber === "2026-0010" ? { courtPrutningBips: 1500 } : {});
    // 2026-0021 = positivt rättsskyddsbesked (100 tim, självrisk 20 % lägst 1 800 kr, #899).
    case "RATTSSKYDD": return matter.matterNumber === "2026-0021"
      ? buildRattsskyddPositivtScenario(parties)
      : buildRattsskyddScenario(parties);
    case "OFFENTLIGT_UPPDRAG":
      return buildOffentligtScenario(parties, offentligtOpts(matter.matterNumber));
    default: return buildPrivatScenario(parties, index, matter.status === "ACTIVE");
  }
}
