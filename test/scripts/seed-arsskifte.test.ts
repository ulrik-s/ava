/**
 * Årsskiftes-ankringen i seeden (#1098).
 *
 * 2026-0020/0021 demonstrerar den RETROAKTIVA normhöjningen (1 586 → 1 626 kr),
 * vilket kräver att arbetet ligger på båda sidor om ett årsskifte. Det uttrycktes
 * med ett fast `createdDaysAgo: 255` — ett relativt offset för ett absolut
 * kalenderfaktum. Den 12 september 2026 gled dag 0 förbi nyår, demon tappade
 * scenariot tyst, och `simulate-orchestrate` blev röd utan att någon commit
 * rört koden.
 *
 * Testerna kör därför mot MÅNGA datum, inte mot "i dag": en bugg som bara visar
 * sig tio månader om året fångas inte av ett testfall som råkar köras i rätt
 * månad. Det var precis så den ursprungliga buggen slapp igenom.
 */

import { describe, it, expect } from "vitest-compat";
import {
  arsskifteCreatedDaysAgo, ARSSKIFTE_DAY_OFFSET, ARSSKIFTE_LAST_DAY,
} from "../../tooling/scripts/seed-data";

/** Datumet för `dayOffset` i ett ärende skapat `createdDaysAgo` dagar före `now`. */
function dayOf(now: Date, createdDaysAgo: number, dayOffset: number): Date {
  const d = new Date(now);
  d.setDate(d.getDate() - createdDaysAgo + dayOffset);
  return d;
}

/** Ett år av körningsdatum — den 1:a och 15:e i varje månad. */
const RUN_DATES: Date[] = [];
for (let year = 2026; year <= 2029; year++) {
  for (let month = 0; month < 12; month++) {
    RUN_DATES.push(new Date(year, month, 1, 12));
    RUN_DATES.push(new Date(year, month, 15, 12));
  }
}

describe("arsskifteCreatedDaysAgo", () => {
  it.each(RUN_DATES.map((d) => [d.toISOString().slice(0, 10), d] as const))(
    "körning %s: dag 0 och sista dagen ligger i olika år",
    (_label, now) => {
      const created = arsskifteCreatedDaysAgo(now);
      const first = dayOf(now, created, 0);
      const last = dayOf(now, created, ARSSKIFTE_LAST_DAY);
      expect(new Set([first.getFullYear(), last.getFullYear()]).size,
        `${first.toDateString()} → ${last.toDateString()}`).toBe(2);
    },
  );

  it.each(RUN_DATES.map((d) => [d.toISOString().slice(0, 10), d] as const))(
    "körning %s: inget i scenariot hamnar i framtiden",
    (_label, now) => {
      const last = dayOf(now, arsskifteCreatedDaysAgo(now), ARSSKIFTE_LAST_DAY);
      expect(last.getTime(), `sista händelsen ${last.toDateString()}`).toBeLessThanOrEqual(now.getTime());
    },
  );

  it.each(RUN_DATES.map((d) => [d.toISOString().slice(0, 10), d] as const))(
    "körning %s: årsgränsen infaller på 31 december",
    (_label, now) => {
      // Scenariotexten lovar att 31 december ligger "runt dag 60". Håller inte
      // det stämmer varken kommentarerna eller aconto-fördelningen över åren.
      const boundary = dayOf(now, arsskifteCreatedDaysAgo(now), ARSSKIFTE_DAY_OFFSET);
      expect({ month: boundary.getMonth(), day: boundary.getDate() }).toEqual({ month: 11, day: 31 });
    },
  );

  it("dag 0 ligger i november, som scenariot och ärendebeskrivningen säger", () => {
    for (const now of RUN_DATES) {
      const first = dayOf(now, arsskifteCreatedDaysAgo(now), 0);
      expect(first.getMonth(), `${now.toDateString()} → ${first.toDateString()}`).toBe(10);
    }
  });
});
