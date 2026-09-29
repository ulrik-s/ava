/**
 * `withoutServerOwned` (#1280) — en radpush med inaktuella metadata får inte
 * återställa serverns dokumentklassning.
 */
import { describe, expect, it } from "vitest-compat";
import { withoutServerOwned } from "@/lib/server/sync/server-owned-fields";

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
