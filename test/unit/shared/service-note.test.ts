/**
 * Test för serviceNoteSchema (#348) — strikt parsning av tjänsteanteckningar.
 */

import { describe, it, expect } from "vitest-compat";
import { serviceNoteSchema } from "@/lib/shared/schemas/service-note";

const valid = {
  id: "sn-1",
  organizationId: "org-1",
  matterId: "m-1",
  authorId: "u-1",
  date: "2026-06-15",
  time: "09:30",
  text: "Klientsamtal — gick igenom tidplan.",
  createdAt: "2026-06-15T09:30:00.000Z",
  updatedAt: "2026-06-15T09:30:00.000Z",
};

describe("serviceNoteSchema", () => {
  it("parsar en giltig anteckning + revivar datum till Date", () => {
    const r = serviceNoteSchema.parse(valid);
    expect(r.text).toBe(valid.text);
    expect(r.date).toBe("2026-06-15");
    expect(r.time).toBe("09:30");
    expect(r.createdAt).toBeInstanceOf(Date);
  });

  it("kräver icke-tom text", () => {
    expect(() => serviceNoteSchema.parse({ ...valid, text: "" })).toThrow();
  });

  it("kräver date + time", () => {
    expect(() => serviceNoteSchema.parse({ ...valid, date: "" })).toThrow();
    expect(() => serviceNoteSchema.parse({ ...valid, time: "" })).toThrow();
  });

  it("kräver matterId + authorId", () => {
    const { matterId: _m, ...noMatter } = valid;
    const { authorId: _a, ...noAuthor } = valid;
    expect(() => serviceNoteSchema.parse(noMatter)).toThrow();
    expect(() => serviceNoteSchema.parse(noAuthor)).toThrow();
  });
});
