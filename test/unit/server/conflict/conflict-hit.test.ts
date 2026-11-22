/**
 * Träffens identitet och kontrollens status (#1819): en regel för vad som är
 * samma träff, vad som sparas på ärendet, och när en tidigare bedömning gäller.
 */

import { describe, expect, it } from "vitest-compat";
import {
  allReviewed, type ConflictResult, conflictHitKey, conflictStatusFor, pushUnique, toConflictHit,
} from "@/lib/server/conflict/conflict-search";
import { asId } from "@/lib/shared/schemas/ids";

const C1 = asId<"ContactId">("c-1");
const C2 = asId<"ContactId">("c-2");
const M1 = asId<"MatterId">("m-1");

const result = (contactId = C1, role: ConflictResult["role"] = "MOTPART"): ConflictResult => ({
  contactId, contactName: "Bo Berg", contactType: "PERSON", personalNumber: "19800101-1234", orgNumber: "556000-1111",
  matterId: M1, matterNumber: "2026-0001", matterTitle: "Tvist", matterStatus: "ACTIVE", role, klient: "Dag Dahl",
});

const h1 = { contactId: C1, matterId: M1, role: "MOTPART" as const };
const h2 = { contactId: C2, matterId: M1, role: "MOTPART" as const };

describe("conflictHitKey", () => {
  it("är (kontakt, ärende, roll), och samma för en ConflictResult och en sparad träff", () => {
    expect(conflictHitKey(h1)).toBe("c-1:m-1:MOTPART");
    expect(conflictHitKey(result())).toBe(conflictHitKey(toConflictHit(result())));
  });

  it("skiljer på roll och kontakt", () => {
    expect(conflictHitKey({ ...h1, role: "KLIENT" })).not.toBe(conflictHitKey(h1));
    expect(conflictHitKey(h2)).not.toBe(conflictHitKey(h1));
  });
});

describe("toConflictHit", () => {
  it("behåller kontakten, rollen och ärendet, utan personnummer, organisationsnummer, klientnamn eller status", () => {
    const hit = toConflictHit(result());
    expect(hit).toEqual({ contactId: C1, contactName: "Bo Berg", role: "MOTPART", matterId: M1, matterNumber: "2026-0001", matterTitle: "Tvist" });
    expect(JSON.stringify(hit)).not.toMatch(/19800101|556000|Dag Dahl/);
  });
});

describe("allReviewed", () => {
  it("utan sparad bedömning är inget bedömt", () => {
    expect(allReviewed([h1], null)).toBe(false);
    expect(allReviewed([h1], undefined)).toBe(false);
    expect(allReviewed([], null)).toBe(false);
  });

  it("samma och färre träffar är bedömda; en ny träff är det inte", () => {
    expect(allReviewed([h1, h2], [h2, h1])).toBe(true);
    expect(allReviewed([h1], [h1, h2])).toBe(true);
    expect(allReviewed([h1, h2], [h1])).toBe(false);
  });

  it("många träffar nära taket jämförs rätt", () => {
    const many = Array.from({ length: 4999 }, (_, i) => ({ contactId: asId<"ContactId">(`c-${i}`), matterId: M1, role: "MOTPART" as const }));
    expect(allReviewed(many, [...many].reverse())).toBe(true);
    expect(allReviewed([...many, { ...h1, contactId: asId<"ContactId">("ny") }], many)).toBe(false);
  });
});

describe("conflictStatusFor", () => {
  it("inga träffar → CLEAR, också utan bedömning", () => {
    expect(conflictStatusFor([], null)).toBe("CLEAR");
    expect(conflictStatusFor([], [h1])).toBe("CLEAR");
  });

  it("alla redan bedömda → REVIEWED; en ny eller ingen bedömning → HITS", () => {
    expect(conflictStatusFor([h1], [h1, h2])).toBe("REVIEWED");
    expect(conflictStatusFor([h1, h2], [h1])).toBe("HITS");
    expect(conflictStatusFor([h1], null)).toBe("HITS");
  });
});

describe("pushUnique", () => {
  it("lägger till nya träffar och hoppar över dubbletter, också inom samma omgång", () => {
    const into = [result()];
    pushUnique(into, [result(), result(C2), result(C2), result(C1, "KLIENT")]);
    expect(into.map(conflictHitKey)).toEqual(["c-1:m-1:MOTPART", "c-2:m-1:MOTPART", "c-1:m-1:KLIENT"]);
  });
});
