/**
 * Förslaget i namnrutan (#1975): sorteringen typ → mapp, mejl på filen och
 * `suggestedFolderPath` ur namnet.
 */
import { describe, expect, it } from "vitest-compat";
import {
  DEFAULT_MATTER_FOLDERS, isMailFile, KIND_FOLDER_PATHS, suggestedFolderPath, type DefaultFolderNode,
} from "@/lib/shared/default-matter-folders";

/** Alla sökvägar i standardträdet, som mappnamn från roten. */
function allPaths(nodes: readonly DefaultFolderNode[], prefix: readonly string[] = []): string[][] {
  return nodes.flatMap((n) => [[...prefix, n.name], ...allPaths(n.children ?? [], [...prefix, n.name])]);
}

describe("KIND_FOLDER_PATHS", () => {
  it("typerna med egen mapp", () => {
    expect(KIND_FOLDER_PATHS.KALLELSE).toEqual(["Domstol", "Kallelse"]);
    expect(KIND_FOLDER_PATHS.FORELAGGANDE).toEqual(["Domstol", "Föreläggande"]);
    expect(KIND_FOLDER_PATHS.FORORDNANDE).toEqual(["Domstol", "Förordnande"]);
    expect(KIND_FOLDER_PATHS.STAMNING).toEqual(["Domstol", "Inlagor"]);
    expect(KIND_FOLDER_PATHS.INLAGA).toEqual(["Domstol", "Inlagor"]);
    expect(KIND_FOLDER_PATHS.DELGIVNINGSKVITTO).toEqual(["Domstol"]);
    expect(KIND_FOLDER_PATHS.DOM).toEqual(["Beslut"]);
    expect(KIND_FOLDER_PATHS.FAKTURA).toEqual(["Faktura"]);
    expect(KIND_FOLDER_PATHS.KOSTNADSRAKNING).toEqual(["Faktura"]);
    expect(KIND_FOLDER_PATHS.AVTAL).toEqual(["Avtal"]);
  });
  it("övriga typer har ingen egen mapp", () => {
    for (const kind of ["FUP", "BEVIS", "FULLMAKT", "RAPPORT", "EPOST", "OKLASSIFICERAT"] as const) {
      expect(KIND_FOLDER_PATHS[kind]).toBeNull();
    }
  });
  it("varje sökväg finns i standardträdet", () => {
    const known = allPaths(DEFAULT_MATTER_FOLDERS).map((p) => p.join("/"));
    for (const path of Object.values(KIND_FOLDER_PATHS)) {
      if (path) expect(known).toContain(path.join("/"));
    }
  });
});

describe("isMailFile", () => {
  it(".eml, .msg och message/rfc822 är mejl", () => {
    expect(isMailFile("a.eml", "")).toBe(true);
    expect(isMailFile("A.MSG", "application/vnd.ms-outlook")).toBe(true);
    expect(isMailFile("utan-andelse", "message/rfc822")).toBe(true);
  });
  it("en PDF är inget mejl", () => expect(isMailFile("a.pdf", "application/pdf")).toBe(false));
});

describe("suggestedFolderPath", () => {
  it("en kallelse → Domstol › Kallelse", () => {
    expect(suggestedFolderPath("Kallelse till huvudförhandling", true)).toEqual(["Domstol", "Kallelse"]);
  });
  it("ett okänt mejl → Korrespondens", () => expect(suggestedFolderPath("Angående mötet", true)).toEqual(["Korrespondens"]));
  it("en okänd PDF → Övrigt", () => expect(suggestedFolderPath("skiss", false)).toEqual(["Övrigt"]));
  it("en fullmakt har ingen egen mapp → Övrigt", () => expect(suggestedFolderPath("Fullmakt", false)).toEqual(["Övrigt"]));
});
