/**
 * Ska ärendet markeras som avslutat? (#2100) — regeln: två kalendermånader i
 * svensk tid sedan det senaste av tidspost, skapande och Behåll som aktivt.
 */

import { describe, it, expect } from "vitest-compat";
import {
  closeReference, closeSuggestionItems, finalRulingReason, noTimeReason,
  type CloseSuggestionCandidate, type FinalRulingCandidate,
} from "@/lib/shared/close-suggestion";
import { stockholmDateTime } from "@/lib/shared/stockholm-time";

/** Mitt på dagen i Stockholm — långt från midnatt. */
const noon = (day: string): Date => stockholmDateTime(day, "12:00");

const candidate = (p: Partial<CloseSuggestionCandidate> = {}): CloseSuggestionCandidate => ({
  id: "m1", matterNumber: "2026-0001", title: "Vårdnadstvist", ...p,
});

describe("closeReference", () => {
  it("är den senaste av tidspost, skapande och Behåll som aktivt", () => {
    const created = noon("2026-01-10");
    const entry = noon("2026-05-02");
    const kept = noon("2026-04-01");
    expect(closeReference(candidate({ createdAt: created, latestEntryAt: entry, keptActiveAt: kept }))).toEqual(entry);
    expect(closeReference(candidate({ createdAt: created, latestEntryAt: entry, keptActiveAt: noon("2026-06-01") })))
      .toEqual(noon("2026-06-01"));
    expect(closeReference(candidate({ createdAt: noon("2026-07-01").toISOString(), latestEntryAt: entry })))
      .toEqual(noon("2026-07-01"));
  });

  it("utan någon referens (eller bara ogiltiga datum) är den null", () => {
    expect(closeReference(candidate())).toBeNull();
    expect(closeReference(candidate({ createdAt: null, keptActiveAt: "inte ett datum" }))).toBeNull();
  });
});

describe("closeSuggestionItems", () => {
  it("exakt två kalendermånader ger en post, en dag tidigare ingen", () => {
    const c = candidate({ latestEntryAt: noon("2026-09-25") });
    expect(closeSuggestionItems([c], noon("2026-11-25"))).toHaveLength(1);
    expect(closeSuggestionItems([c], noon("2026-11-24"))).toEqual([]);
  });

  it("en dag som inte finns i målmånaden blir månadens sista: 2026-12-31 ger posten från 2027-02-28", () => {
    const c = candidate({ createdAt: noon("2026-12-31") });
    expect(closeSuggestionItems([c], noon("2027-02-27"))).toEqual([]);
    expect(closeSuggestionItems([c], noon("2027-02-28"))).toHaveLength(1);
  });

  it("svensk dag gäller runt midnatt", () => {
    // 2026-09-24 22:30 UTC är 2026-09-25 00:30 i Stockholm.
    const c = candidate({ latestEntryAt: new Date("2026-09-24T22:30:00Z") });
    // 2026-11-24 23:30 UTC är 2026-11-25 00:30 i Stockholm (vintertid).
    const [item] = closeSuggestionItems([c], new Date("2026-11-24T23:30:00Z"));
    expect(item?.detail).toBe("Ingen tid registrerad sedan 2026-09-25.");
    expect(closeSuggestionItems([c], new Date("2026-11-24T22:30:00Z"))).toEqual([]);
  });

  it("utan någon referens blir det ingen post", () => {
    expect(closeSuggestionItems([candidate()], noon("2030-01-01"))).toEqual([]);
  });

  it("posten har rubrik, skäl, allvarsgrad, länk och frågans uppgifter", () => {
    const [item] = closeSuggestionItems([candidate({ latestEntryAt: noon("2026-09-25") })], noon("2026-12-01"));
    expect(item).toEqual({
      kind: "closeSuggestion",
      severity: "approaching",
      title: "Ska ärendet markeras som avslutat?",
      detail: "Ingen tid registrerad sedan 2026-09-25.",
      matterId: "m1", matterNumber: "2026-0001",
      at: null, amountOre: null,
      link: { route: "matters", id: "m1" },
      closeSuggestion: { matterTitle: "Vårdnadstvist", noTimeSince: "2026-09-25", documents: [] },
    });
  });

  it("högst en post per ärende, och ärenden som inte stått still länge nog hoppas över", () => {
    const old = candidate({ latestEntryAt: noon("2026-01-01") });
    const fresh = candidate({ id: "m2", matterNumber: "2026-0002", latestEntryAt: noon("2026-11-20") });
    const items = closeSuggestionItems([old, old, fresh], noon("2026-11-25"));
    expect(items.map((i) => i.matterId)).toEqual(["m1"]);
  });
});

describe("closeSuggestionItems — slutligt avgörande (#2101)", () => {
  const ruling = (id: string, createdAt: Date | string, p: Partial<FinalRulingCandidate> = {}): FinalRulingCandidate => ({
    id, fileName: `${id}.pdf`, storagePath: `documents/content/${id}.pdf`, createdAt, finalRuling: "DOM_HD", ...p,
  });
  /** Ett färskt ärende: regel 1 slår inte till. */
  const fresh = (p: Partial<CloseSuggestionCandidate>): CloseSuggestionCandidate =>
    candidate({ latestEntryAt: noon("2026-11-20"), ...p });
  const now = noon("2026-11-25");

  it("de fem texterna", () => {
    expect(finalRulingReason("AVSKRIVNING")).toBe("ser ut att vara ett slutligt beslut om avskrivning.");
    expect(finalRulingReason("DOM_HD")).toBe("ser ut att vara en dom från Högsta domstolen.");
    expect(finalRulingReason("DOM_HFD")).toBe("ser ut att vara en dom från Högsta förvaltningsdomstolen.");
    expect(finalRulingReason("PT_HD"))
      .toBe("ser ut att vara ett beslut från Högsta domstolen att inte meddela prövningstillstånd.");
    expect(finalRulingReason("PT_HFD"))
      .toBe("ser ut att vara ett beslut från Högsta förvaltningsdomstolen att inte meddela prövningstillstånd.");
    expect(noTimeReason("2026-09-25")).toBe("Ingen tid registrerad sedan 2026-09-25.");
  });

  it("utan Behåll som aktivt ger dokumentet ett skäl; en post med bara dokument har noTimeSince null", () => {
    const [item] = closeSuggestionItems([fresh({ finalRulings: [ruling("d1", noon("2026-11-24"), { finalRuling: "PT_HFD" })] })], now);
    expect(item?.closeSuggestion).toEqual({
      matterTitle: "Vårdnadstvist", noTimeSince: null,
      documents: [{ id: "d1", fileName: "d1.pdf", storagePath: "documents/content/d1.pdf", ruling: "PT_HFD" }],
    });
    expect(item?.detail).toBe(
      "d1.pdf ser ut att vara ett beslut från Högsta förvaltningsdomstolen att inte meddela prövningstillstånd.",
    );
    expect(item?.title).toBe("Ska ärendet markeras som avslutat?");
  });

  it("ett dokument efter Behåll som aktivt ger ett skäl, ett före eller samtidigt inget", () => {
    const kept = noon("2026-11-10");
    const docs = [ruling("before", noon("2026-11-09")), ruling("same", kept), ruling("after", noon("2026-11-11").toISOString())];
    const [item] = closeSuggestionItems([fresh({ keptActiveAt: kept, finalRulings: docs })], now);
    expect(item?.closeSuggestion?.documents.map((d) => d.id)).toEqual(["after"]);
    const onlyOld = fresh({ keptActiveAt: kept, finalRulings: [ruling("before", noon("2026-11-09")), ruling("same", kept)] });
    expect(closeSuggestionItems([onlyOld], now)).toEqual([]);
  });

  it("båda reglerna ger EN post: tidsskälet först, sedan dokumenten i den ordning de lades in", () => {
    const docs = [ruling("late", noon("2026-11-20"), { finalRuling: "AVSKRIVNING" }), ruling("early", noon("2026-10-01"))];
    const items = closeSuggestionItems([candidate({ latestEntryAt: noon("2026-09-01"), finalRulings: docs })], now);
    expect(items).toHaveLength(1);
    expect(items[0]?.closeSuggestion?.noTimeSince).toBe("2026-09-01");
    expect(items[0]?.closeSuggestion?.documents.map((d) => d.id)).toEqual(["early", "late"]);
    expect(items[0]?.detail).toBe(
      "Ingen tid registrerad sedan 2026-09-01. early.pdf ser ut att vara en dom från Högsta domstolen. "
      + "late.pdf ser ut att vara ett slutligt beslut om avskrivning.",
    );
  });
});
