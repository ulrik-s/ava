import { describe, it, expect } from "vitest";
import { isJunkFileName } from "@/lib/junk-files";

describe("isJunkFileName — OS-skräp som aldrig ska sparas", () => {
  it("fångar AppleDouble-filer (._*)", () => {
    expect(isJunkFileName("._Uppdragsavtal.pdf")).toBe(true);
    expect(isJunkFileName("._anything")).toBe(true);
  });

  it("fångar macOS sb-temporärfiler", () => {
    expect(isJunkFileName("Doc.pdf.sb-12abcdef-AbC123")).toBe(true);
  });

  it("fångar kända exakta namn (.DS_Store, Thumbs.db, etc.)", () => {
    expect(isJunkFileName(".DS_Store")).toBe(true);
    expect(isJunkFileName("Thumbs.db")).toBe(true);
    expect(isJunkFileName("desktop.ini")).toBe(true);
    expect(isJunkFileName(".localized")).toBe(true);
    expect(isJunkFileName(".Spotlight-V100")).toBe(true);
  });

  it("släpper igenom riktiga dokument", () => {
    expect(isJunkFileName("2026-0001 Uppdragsavtal.pdf")).toBe(false);
    expect(isJunkFileName("faktura_18055.pdf")).toBe(false);
    expect(isJunkFileName("underlag.docx")).toBe(false);
  });

  it("är skiftlägeskänslig för exakta namn", () => {
    // Thumbs.db är exakt — thumbs.db räknas ej (filsystem på macOS är ofta
    // case-insensitive men vi vill inte gissa, så exakt matchning gäller).
    expect(isJunkFileName("thumbs.db")).toBe(false);
  });

  it("avvisar tomt namn", () => {
    expect(isJunkFileName("")).toBe(true);
  });

  it("släpper igenom filer vars namn bara börjar på '.' (ej ._)", () => {
    expect(isJunkFileName(".env")).toBe(false);
    expect(isJunkFileName(".hidden-doc.pdf")).toBe(false);
  });
});
