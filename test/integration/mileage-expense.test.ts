/**
 * Integration (#1529): en milersättning blir ett vanligt utlägg som når
 * fakturaspecifikationen med 25 % moms och resans beskrivning — utan egen
 * utläggstyp eller kolumn.
 */

import { describe, it, expect } from "vitest-compat";
import { specExpenseLines } from "@/lib/shared/invoice-specification";
import { mileageExpensePayload } from "@/lib/shared/mileage-rate";

const payload = mileageExpensePayload({ date: "2026-03-15", from: "A", to: "B", mil: 3.5, krPerMil: 25 });

describe("milersättning på fakturaspecifikationen", () => {
  it("öresavrundad faktura: 87,50 kr exkl., 109,38 kr inkl. moms", () => {
    expect(specExpenseLines([payload], "ORE")).toEqual([{
      date: "2026-03-15", description: "Milersättning A – B, 3,5 mil à 25 kr",
      netOre: 8750, grossOre: 10938, passThrough: false,
    }]);
  });

  it("hela kronor per rad: nettot avrundas och momsen läggs på", () => {
    const [line] = specExpenseLines([payload], "KRONOR");
    expect(line?.description).toBe("Milersättning A – B, 3,5 mil à 25 kr");
    expect(line?.netOre).toBe(8800);
    expect(line?.grossOre).toBe(11000);
  });
});
