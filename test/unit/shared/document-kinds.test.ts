/**
 * Dokumentets typer (ADR 0038): normalisering, läsregeln, skrivregeln och
 * reglerna för äldre rader — det all kod går genom, så att inget värde tappas
 * medan användare migrerar data.
 */
import { describe, expect, it } from "vitest-compat";
import {
  documentKinds, hasKind, isCustomKind, kindsAreManual, kindsFields, legacyKinds, legacyKindsManual,
  needsKindsBackfill, normalizeKind, normalizeKinds, organizationKinds, sameKinds,
} from "@/lib/shared/document-kinds";

describe("normalizeKind", () => {
  it("kod, visningsnamn och synonymer blir en inbyggd kod (skiftläges- och blankstegsokänsligt)", () => {
    expect(normalizeKind("KALLELSE")).toBe("KALLELSE");
    expect(normalizeKind("kallelse")).toBe("KALLELSE");
    expect(normalizeKind("  Förordnande ")).toBe("FORORDNANDE");
    expect(normalizeKind("Dom/beslut")).toBe("DOM");
    expect(normalizeKind("Beslut")).toBe("DOM");
    expect(normalizeKind("Stämningsansökan")).toBe("STAMNING");
    expect(normalizeKind("Kostnadsräkning")).toBe("KOSTNADSRAKNING");
    expect(normalizeKind("E-post")).toBe("EPOST");
    expect(normalizeKind("Övrigt")).toBe("OKLASSIFICERAT");
  });

  it("allt annat behålls som byråns egen typ; tomt → null", () => {
    expect(normalizeKind("Sekretess  beslut")).toBe("Sekretess beslut");
    expect(normalizeKind("Korrespondens")).toBe("Korrespondens");
    expect(normalizeKind("   ")).toBeNull();
    expect(normalizeKind(null)).toBeNull();
    expect(normalizeKind(undefined)).toBeNull();
  });

  it("normalizeKinds: inga tomma, inga dubbletter, ordningen behålls", () => {
    expect(normalizeKinds(["Dom", "beslut", null, "", "Kallelse", "DOM"])).toEqual(["DOM", "KALLELSE"]);
  });
});

describe("läsregeln (documentKinds)", () => {
  it("egna kinds vinner", () => {
    expect(documentKinds({ kinds: ["FORORDNANDE", "Korrespondens"], documentType: "DOM", tags: ["X"] })).toEqual(["FORORDNANDE", "Korrespondens"]);
  });

  it("medvetet tömda typer (kindsManual) härleds inte ur de äldre fälten", () => {
    expect(documentKinds({ kinds: [], kindsManual: true, documentType: "DOM" })).toEqual([]);
  });

  it("äldre rad: delarna, documentType och taggarna, normaliserade", () => {
    expect(documentKinds({ kinds: [], documentType: "KALLELSE", tags: ["Bevisning", "Korrespondens"], parts: [{ kind: "KALLELSE" }, { kind: "FUP" }] }))
      .toEqual(["KALLELSE", "FUP", "BEVIS", "Korrespondens"]);
    expect(documentKinds({ documentType: "Kostnadsräkning" })).toEqual(["KOSTNADSRAKNING"]);
    expect(documentKinds({})).toEqual([]);
  });

  it("hasKind och sameKinds", () => {
    expect(hasKind({ documentType: "Kostnadsräkning" }, "KOSTNADSRAKNING")).toBe(true);
    expect(hasKind({ kinds: ["DOM"] }, "KOSTNADSRAKNING")).toBe(false);
    expect(sameKinds(["A", "B"], ["B", "A"])).toBe(true);
    expect(sameKinds(["A"], ["A", "B"])).toBe(false);
  });
});

describe("skrivregeln (kindsFields)", () => {
  it("normaliserar, speglar primärtypen och tömmer taggarna", () => {
    expect(kindsFields(["förordnande", "Korrespondens", "Förordnande"], true))
      .toEqual({ kinds: ["FORORDNANDE", "Korrespondens"], kindsManual: true, documentType: "FORORDNANDE", tags: [] });
    expect(kindsFields([], false)).toEqual({ kinds: [], kindsManual: false, documentType: null, tags: [] });
  });
});

describe("äldre rader", () => {
  it("needsKindsBackfill: typer bara i de äldre fälten", () => {
    expect(needsKindsBackfill({ kinds: [], documentType: "DOM" })).toBe(true);
    expect(needsKindsBackfill({ tags: ["X"] })).toBe(true);
    expect(needsKindsBackfill({ kinds: ["DOM"], documentType: "DOM" })).toBe(false);
    expect(needsKindsBackfill({ kinds: [], kindsManual: true, documentType: "DOM" })).toBe(false);
    expect(needsKindsBackfill({ kinds: [] })).toBe(false);
  });

  it("legacyKinds ur de äldre fälten", () => {
    expect(legacyKinds({ documentType: "Faktura", tags: ["Faktura"] })).toEqual(["FAKTURA"]);
  });

  it("legacyKindsManual: specialvärden, manuell första del och användarsatt kod", () => {
    expect(legacyKindsManual({ documentType: "Kostnadsräkning" })).toBe(true);
    expect(legacyKindsManual({ documentType: "E-post" })).toBe(true);
    expect(legacyKindsManual({ documentType: "DOM", parts: [{ source: "MANUAL" }] })).toBe(true);
    expect(legacyKindsManual({ documentType: "AVTAL", fileName: "kallelse.pdf" })).toBe(true);
    expect(legacyKindsManual({ documentType: "KALLELSE", fileName: "kallelse.pdf" })).toBe(false);
    expect(legacyKindsManual({ documentType: "AVTAL", fileName: "kallelse.pdf", analysisModel: "llm" })).toBe(false);
    expect(legacyKindsManual({ documentType: "DOM", parts: [{ source: "AUTO" }] })).toBe(false);
    expect(legacyKindsManual({})).toBe(false);
  });

  it("kindsAreManual: flaggan, eller en äldre rad som sattes för hand", () => {
    expect(kindsAreManual({ kinds: ["DOM"], kindsManual: true })).toBe(true);
    expect(kindsAreManual({ kinds: ["DOM"], kindsManual: false })).toBe(false);
    expect(kindsAreManual({ kinds: [], documentType: "Kostnadsräkning" })).toBe(true);
    expect(kindsAreManual({ kinds: [], documentType: "KALLELSE", fileName: "kallelse.pdf" })).toBe(false);
  });
});

describe("byråns egna typer (organizationKinds)", () => {
  it("documentKinds, annars taggvokabulärens icke-inbyggda värden", () => {
    expect(organizationKinds({ documentKinds: ["Sekretess"], documentTags: ["Annat"] })).toEqual(["Sekretess"]);
    expect(organizationKinds({ documentKinds: [], documentTags: ["Kallelse", "Korrespondens", "Bevisning", "Yttrande"] })).toEqual(["Korrespondens"]);
    expect(organizationKinds(null)).toEqual([]);
  });

  it("isCustomKind", () => {
    expect(isCustomKind("KALLELSE")).toBe(false);
    expect(isCustomKind("Korrespondens")).toBe(true);
  });
});
