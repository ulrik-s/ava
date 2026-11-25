/**
 * Fälten för förslaget att avsluta ett ärende (#2098): dokumentets igenkända
 * avgörande och ärendets datum för Behåll som aktivt.
 */
import { describe, expect, it } from "vitest-compat";
import { documentSchema, finalRulingSchema } from "@/lib/shared/schemas/document";
import { matterSchema } from "@/lib/shared/schemas/matter";

const DOC = {
  id: "d1", organizationId: "o1", matterId: "m1", fileName: "dom.pdf", mimeType: "application/pdf", sizeBytes: 1,
  storagePath: "x", uploadedById: "u1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};
const MATTER = {
  id: "m1", organizationId: "o1", matterNumber: "2026-0001", title: "Tvist", status: "ACTIVE",
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("documentSchema.finalRuling (#2098)", () => {
  it.each(finalRulingSchema.options)("tar emot %s", (value) => {
    expect(documentSchema.parse({ ...DOC, finalRuling: value }).finalRuling).toBe(value);
  });

  it("de fem avgörandena", () => {
    expect(finalRulingSchema.options).toEqual(["AVSKRIVNING", "DOM_HD", "DOM_HFD", "PT_HD", "PT_HFD"]);
  });

  it("null och ett saknat fält betyder att inget har känts igen", () => {
    expect(documentSchema.parse({ ...DOC, finalRuling: null }).finalRuling).toBeNull();
    expect(documentSchema.parse(DOC).finalRuling).toBeUndefined();
  });

  it("avvisar ett okänt värde", () => {
    expect(documentSchema.safeParse({ ...DOC, finalRuling: "DOM" }).success).toBe(false);
  });
});

describe("matterSchema.keptActiveAt (#2098)", () => {
  it("läser en ISO-sträng som datum", () => {
    const parsed = matterSchema.parse({ ...MATTER, keptActiveAt: "2026-11-25T10:00:00.000Z" });
    expect(new Date(String(parsed.keptActiveAt)).toISOString()).toBe("2026-11-25T10:00:00.000Z");
  });

  it("null = ingen har valt Behåll som aktivt", () => {
    expect(matterSchema.parse({ ...MATTER, keptActiveAt: null }).keptActiveAt).toBeNull();
  });
});
