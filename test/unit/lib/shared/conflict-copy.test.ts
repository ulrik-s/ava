/**
 * conflictCopyName (ADR 0033 §4) — namnger keep-both-syskonet så det är
 * självklart vilket dokument som är användarens egen ändring.
 */

import { describe, it, expect } from "vitest-compat";
import { conflictCopyName } from "@/lib/shared/conflict-copy";

describe("conflictCopyName", () => {
  it("infogar etiketten före filändelsen", () => {
    expect(conflictCopyName("Avtal.docx", "2026-06-22 14:32")).toBe("Avtal (din ändring 2026-06-22 14:32).docx");
    expect(conflictCopyName("rapport.pdf", "2026-01-02 03:04")).toBe("rapport (din ändring 2026-01-02 03:04).pdf");
  });

  it("hanterar filer utan ändelse (suffix sist)", () => {
    expect(conflictCopyName("README", "L")).toBe("README (din ändring L)");
  });

  it("behandlar dotfiler som utan ändelse (lägger suffixet sist)", () => {
    expect(conflictCopyName(".gitignore", "L")).toBe(".gitignore (din ändring L)");
  });

  it("delar på SISTA punkten (flera punkter)", () => {
    expect(conflictCopyName("v1.2.docx", "L")).toBe("v1.2 (din ändring L).docx");
  });
});
