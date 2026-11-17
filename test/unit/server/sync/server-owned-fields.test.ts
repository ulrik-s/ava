/**
 * `withoutServerOwned` (#1280) — en radpush med inaktuella metadata får inte
 * återställa serverns dokumentklassning.
 */
import { describe, expect, it } from "vitest-compat";
import { withKindsFromLegacy, withoutServerOwned } from "@/lib/server/sync/server-owned-fields";

const classified = {
  id: "d1", fileName: "stamning.pdf", documentType: "STAMNING", tags: ["tvist"], summary: "Stämning",
  analyzedAt: new Date("2026-09-01T10:00:00Z"), analysisStatus: "DONE", analysisModel: "m", analysisError: null,
};

describe("withoutServerOwned", () => {
  it("klienten har inte sett klassningen: bara användarens övriga ändringar går igenom", () => {
    const stale = { ...classified, fileName: "stamning-ny.pdf", documentType: null, tags: [], summary: null, analyzedAt: null, analysisStatus: "PENDING" };
    expect(withoutServerOwned("document", classified, stale)).toEqual({ id: "d1", fileName: "stamning-ny.pdf" });
  });

  it("klienten har sett klassningen: användarens egen typ vinner, analysfälten rörs inte", () => {
    const edited = { ...classified, analyzedAt: "2026-09-01T10:00:00.000Z", documentType: "DOM", analysisStatus: "PENDING" };
    const patch = withoutServerOwned("document", classified, edited);
    expect(patch).toMatchObject({ documentType: "DOM", tags: ["tvist"] });
    expect(patch).not.toHaveProperty("analysisStatus");
    expect(patch).not.toHaveProperty("analyzedAt");
  });

  it("ett oklassat dokument: klassningsfälten går igenom (användaren sätter typen själv)", () => {
    const fresh = { ...classified, analyzedAt: null, analysisStatus: "PENDING", documentType: null };
    expect(withoutServerOwned("document", fresh, { ...fresh, documentType: "AVTAL" })).toMatchObject({ documentType: "AVTAL" });
  });

  it("andra entiteter lämnas orörda", () => {
    const row = { id: "t1", analysisStatus: "X" };
    expect(withoutServerOwned("timeEntry", {}, row)).toBe(row);
  });
});

describe("withKindsFromLegacy (ADR 0038 — äldre klienters dokumentrader)", () => {
  const stored = { id: "d1", kinds: ["KALLELSE", "Korrespondens"], kindsManual: false, documentType: "KALLELSE", tags: [] };

  it("rader med kinds, andra entiteter och rader utan äldre fält passerar orörda", () => {
    const withKinds = { kinds: ["DOM"], documentType: "DOM" };
    expect(withKindsFromLegacy("document", stored, withKinds)).toBe(withKinds);
    expect(withKindsFromLegacy("matter", null, { documentType: "x" })).toEqual({ documentType: "x" });
    expect(withKindsFromLegacy("document", stored, { fileName: "nytt.pdf" })).toEqual({ fileName: "nytt.pdf" });
  });

  it("oförändrade äldre fält tas bort — typerna står kvar (även egna typer från taggar)", () => {
    expect(withKindsFromLegacy("document", stored, { fileName: "a.pdf", documentType: "KALLELSE", tags: [] })).toEqual({ fileName: "a.pdf" });
    // En flik som hämtade raden före flytten: fritext + taggar, samma typer.
    expect(withKindsFromLegacy("document", stored, { documentType: "Kallelse", tags: ["Korrespondens"] })).toEqual({});
  });

  it("ändrad typ från en gammal flik blir nya typer; flaggan står kvar", () => {
    expect(withKindsFromLegacy("document", stored, { documentType: "DOM", tags: [] }))
      .toEqual({ kinds: ["DOM"], kindsManual: false, documentType: "DOM", tags: [] });
  });

  it("ett nytt dokument från en gammal flik får typer; specialvärden räknas som satta för hand", () => {
    expect(withKindsFromLegacy("document", null, { id: "d2", documentType: "Kostnadsräkning" }))
      .toEqual({ id: "d2", kinds: ["KOSTNADSRAKNING"], kindsManual: true, documentType: "KOSTNADSRAKNING", tags: [] });
  });
});
