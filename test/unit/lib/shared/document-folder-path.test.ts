/**
 * Mappträdets sökvägar (#1974): folderNamePath och folderChoices.
 */
import { describe, expect, it } from "vitest-compat";
import { folderChoices, folderNamePath, type FolderNode } from "@/lib/shared/document-folder-path";

const FOLDERS: FolderNode[] = [
  { id: "kallelse", name: "Kallelse", parentId: "domstol" },
  { id: "domstol", name: "Domstol", parentId: null },
  { id: "aklagare", name: "Åklagare" },
  { id: "arende", name: "Ärende", parentId: null },
  { id: "avtal", name: "Avtal", parentId: null },
  { id: "beslut", name: "Beslut", parentId: "domstol" },
];

describe("folderNamePath", () => {
  it("en rotmapp ger sitt namn", () => expect(folderNamePath("domstol", FOLDERS)).toEqual(["Domstol"]));
  it("en undermapp ger namnen från roten", () => expect(folderNamePath("kallelse", FOLDERS)).toEqual(["Domstol", "Kallelse"]));
  it("en okänd mapp ger []", () => expect(folderNamePath("saknas", FOLDERS)).toEqual([]));
  it("null ger []", () => expect(folderNamePath(null, FOLDERS)).toEqual([]));
  it("en cykel i trädet ger varje mapp en gång", () => {
    const cycle: FolderNode[] = [{ id: "a", name: "A", parentId: "b" }, { id: "b", name: "B", parentId: "a" }];
    expect(folderNamePath("a", cycle)).toEqual(["B", "A"]);
  });
});

describe("folderChoices", () => {
  it("föräldrar före barn, syskon i svensk ordning (Å före Ä, sist), etiketten med ›", () => {
    expect(folderChoices(FOLDERS)).toEqual([
      { id: "avtal", label: "Avtal" },
      { id: "domstol", label: "Domstol" },
      { id: "beslut", label: "Domstol › Beslut" },
      { id: "kallelse", label: "Domstol › Kallelse" },
      { id: "aklagare", label: "Åklagare" },
      { id: "arende", label: "Ärende" },
    ]);
  });
  it("inga mappar ger inga val", () => expect(folderChoices([])).toEqual([]));
});
