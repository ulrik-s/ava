/** Namnbyte på dokument (document-file-name.ts): städning och behållen filändelse. */

import { describe, expect, it } from "vitest-compat";
import { cleanFileName, fileExtension, MAX_FILE_NAME } from "@/lib/shared/document-file-name";

describe("cleanFileName", () => {
  it("behåller originalets filändelse om den togs bort", () => {
    expect(cleanFileName("Stämning", "scan_001.pdf")).toBe("Stämning.pdf");
    expect(cleanFileName("Stämning.PDF", "scan_001.pdf")).toBe("Stämning.PDF");
  });

  it("tar bort sökvägs- och styrtecken, och punkter först", () => {
    expect(cleanFileName("../a/b:c\u0007", "x.docx")).toBe("a b c.docx");
  });

  it("tomt → null", () => {
    expect(cleanFileName("   ", "x.pdf")).toBeNull();
    expect(cleanFileName("///", "x.pdf")).toBeNull();
  });

  it("för långt kortas men behåller filändelsen", () => {
    const out = cleanFileName("a".repeat(500), "x.pdf") ?? "";
    expect(out.length).toBe(MAX_FILE_NAME);
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("utan filändelse i originalet läggs ingen till", () => {
    expect(fileExtension("README")).toBe("");
    expect(cleanFileName("Anteckning", "README")).toBe("Anteckning");
  });
});
