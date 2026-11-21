/**
 * Jävskontrollens träffar på ärendet och ärendet på loggraden (#1818).
 */

import { describe, it, expect } from "vitest-compat";
import { matterSchema } from "@/lib/shared/schemas/matter";
import { conflictCheckSchema, conflictHitSchema } from "@/lib/shared/schemas/misc";

const HIT = {
  contactId: "c-1",
  contactName: "Bo Berg",
  role: "MOTPART",
  matterId: "m-1",
  matterNumber: "2026-1",
  matterTitle: "Tvist",
};

describe("conflictHitSchema", () => {
  it("godtar en giltig träff", () => {
    expect(conflictHitSchema.parse(HIT)).toEqual(HIT);
  });

  it("avvisar en träff utan kontakt eller ärende", () => {
    const { contactId: _c, ...noContact } = HIT;
    const { matterId: _m, ...noMatter } = HIT;
    expect(conflictHitSchema.safeParse(noContact).success).toBe(false);
    expect(conflictHitSchema.safeParse(noMatter).success).toBe(false);
  });

  it("avvisar en okänd roll", () => {
    expect(conflictHitSchema.safeParse({ ...HIT, role: "GRANNE" }).success).toBe(false);
  });

  it("bär inga personnummer eller klientnamn", () => {
    const parsed = conflictHitSchema.parse({ ...HIT, personalNumber: "19800101-1234", klient: "Klient AB" });
    expect(parsed).toEqual(HIT);
  });
});

describe("matterSchema — conflictCheckResults och conflictReviewedHits", () => {
  for (const field of ["conflictCheckResults", "conflictReviewedHits"] as const) {
    const schema = matterSchema.shape[field];

    it(`${field}: null, saknat fält och en lista godtas`, () => {
      expect(schema.parse(null)).toBeNull();
      expect(schema.parse(undefined)).toBeUndefined();
      expect(schema.parse([HIT])).toEqual([HIT]);
      expect(schema.parse([])).toEqual([]);
    });

    it(`${field}: en lista med en ogiltig träff avvisas`, () => {
      expect(schema.safeParse([{ contactName: "Bo" }]).success).toBe(false);
    });
  }
});

describe("conflictCheckSchema — matterId", () => {
  const CHECK = { id: "cc-1", searchTerm: "Bo", searchType: "name", results: [], checkedById: "u-1", createdAt: "2026-01-01T00:00:00Z" };

  it("ärendet är valfritt: saknat, null och ett id godtas", () => {
    expect(conflictCheckSchema.parse(CHECK).matterId).toBeUndefined();
    expect(conflictCheckSchema.parse({ ...CHECK, matterId: null }).matterId).toBeNull();
    expect(conflictCheckSchema.parse({ ...CHECK, matterId: "m-1" }).matterId).toBe("m-1");
  });
});
