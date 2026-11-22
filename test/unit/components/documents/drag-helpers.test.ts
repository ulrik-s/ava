/** Släpp i dokumentvyn (#1615): AVA-rad, filer utifrån eller varken eller. */
import { describe, expect, it } from "vitest-compat";
import { classifyDrop, formatFileSize, isExternalDrag } from "@/components/documents/_drag-helpers";

const pdf = new File(["%PDF"], "a.pdf", { type: "application/pdf" });

describe("classifyDrop", () => {
  it("en pågående AVA-dragning är en flytt, även om filer följer med", () => {
    expect(classifyDrop({ type: "document", id: "d1" }, { files: [pdf] })).toEqual({ kind: "move", item: { type: "document", id: "d1" } });
  });

  it("filer utifrån", () => {
    expect(classifyDrop(null, { files: [pdf] })).toEqual({ kind: "files", files: [pdf] });
  });

  it("utan filer (tom lista eller saknad) → går inte att läsa", () => {
    expect(classifyDrop(null, { files: [] })).toEqual({ kind: "unreadable" });
    expect(classifyDrop(null, { files: null })).toEqual({ kind: "unreadable" });
  });
});

describe("isExternalDrag", () => {
  it("filer, text, länk och html kommer utifrån", () => {
    for (const t of ["Files", "text/plain", "text/uri-list", "text/html"]) expect(isExternalDrag({ types: [t] })).toBe(true);
  });

  it("en kolumndragning eller inget alls gör det inte", () => {
    expect(isExternalDrag({ types: ["text/x-col"] })).toBe(false);
    expect(isExternalDrag({ types: [] })).toBe(false);
  });
});

describe("formatFileSize", () => {
  it("byte, kilobyte och megabyte", () => {
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(5000)).toBe("5 KB");
    expect(formatFileSize(5_000_000)).toBe("4.8 MB");
  });
});
