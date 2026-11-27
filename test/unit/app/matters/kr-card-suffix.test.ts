/**
 * KR-kortets rubriktillägg (#2180): referensen och förordnandemålets avslut,
 * var för sig eller tillsammans.
 */
import { describe, expect, it } from "vitest-compat";
import { krCardSuffix } from "@/app/matters/[id]/_billing-runs-list";

describe("krCardSuffix", () => {
  it("referens och avslut", () => {
    expect(krCardSuffix({ reference: "KR-2026-0001", forordnandeAvslut: "STRAFFORELAGGANDE" }))
      .toBe(" KR-2026-0001 · Strafföreläggande godkändes");
  });

  it("bara det ena", () => {
    expect(krCardSuffix({ reference: "KR-2026-0001", forordnandeAvslut: null })).toBe(" KR-2026-0001");
    expect(krCardSuffix({ forordnandeAvslut: "INGET_ATAL" })).toBe(" Förundersökningen avslutades utan åtal");
  });

  it("inget → tomt", () => {
    expect(krCardSuffix({})).toBe("");
  });
});
