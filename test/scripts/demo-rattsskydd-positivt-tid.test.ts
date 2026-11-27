/**
 * Demoärendet 2026-0021 (rättsskydd, positivt besked) ska stå utan tid i mer än
 * två kalendermånader, så att Att åtgärda frågar om det ska avslutas (#2100) och
 * e2e-testet hittar posten året runt.
 *
 * Ärendet skapas minst `ARSSKIFTE_LAST_DAY` dagar före bygget. Två
 * kalendermånader är högst 62 dagar; med sista tidsposten senast dag
 * `ARSSKIFTE_LAST_DAY − 65` ligger den alltid minst 65 dagar bakåt. Utan testet
 * kan en senare tidspost i scenariot tyst göra e2e-testet årstidsberoende.
 */

import { describe, it, expect } from "vitest-compat";
import { buildRattsskyddPositivtScenario } from "../../tooling/demo-generator/simulate/scenarios/rattsskydd-positivt";
import { ARSSKIFTE_LAST_DAY } from "../../tooling/scripts/seed-data";

const MARGIN_DAYS = 65;

describe("rättsskyddsscenariot med positivt besked (#2100)", () => {
  it(`har ingen tidspost efter dag ARSSKIFTE_LAST_DAY − ${MARGIN_DAYS}`, () => {
    const parties = { klient: "k", motpart: "m", motpartsombud: "o", domstol: "d" };
    const days = buildRattsskyddPositivtScenario(parties)
      .flatMap((e) => (e.kind === "time" ? [e.dayOffset] : []));
    expect(days.length).toBeGreaterThan(0);
    expect(Math.max(...days)).toBeLessThanOrEqual(ARSSKIFTE_LAST_DAY - MARGIN_DAYS);
  });
});
