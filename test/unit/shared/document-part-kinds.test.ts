/**
 * `document-part-kinds` (#1220) — kategorier via delar, gruppering, sida → del.
 */

import { describe, expect, it } from "vitest-compat";
import { countKinds, groupPartsByDocument, kindCountsByName, kindsOf, partForPage } from "@/lib/shared/document-part-kinds";

const P = (documentId: string, kind: string, fromPage: number, toPage: number, deletedAt?: Date) =>
  ({ documentId, kind, fromPage, toPage, ...(deletedAt ? { deletedAt } : {}) });

describe("kindsOf", () => {
  it("delarnas unika typer, annars documentType, annars tomt", () => {
    expect(kindsOf({ documentType: "DOM", parts: [P("d", "KALLELSE", 1, 1), P("d", "FUP", 2, 3), P("d", "FUP", 4, 4)] })).toEqual(["KALLELSE", "FUP"]);
    expect(kindsOf({ documentType: "Kostnadsräkning", parts: [] })).toEqual(["Kostnadsräkning"]);
    expect(kindsOf({ documentType: null })).toEqual([]);
  });
});

describe("groupPartsByDocument", () => {
  it("grupperar levande delar per dokument i sidordning", () => {
    const g = groupPartsByDocument([P("a", "FUP", 3, 4), P("a", "KALLELSE", 1, 2), P("b", "DOM", 1, 1), P("a", "DOM", 5, 5, new Date())]);
    expect(g.get("a")?.map((p) => p.kind)).toEqual(["KALLELSE", "FUP"]);
    expect(g.get("b")).toHaveLength(1);
  });
});

describe("partForPage", () => {
  const parts = [P("a", "KALLELSE", 1, 2), P("a", "STAMNING", 3, 7)];
  it("delen som innehåller sidan", () => {
    expect(partForPage(parts, 5)?.kind).toBe("STAMNING");
    expect(partForPage(parts, 2)?.kind).toBe("KALLELSE");
  });
  it("okänd sida / inga delar / sida utanför → null", () => {
    expect(partForPage(parts, null)).toBeNull();
    expect(partForPage(undefined, 1)).toBeNull();
    expect(partForPage(parts, 99)).toBeNull();
  });
});

describe("countKinds / kindCountsByName", () => {
  it("ett dokument räknas en gång per unik deltyp; sorterat på namn", () => {
    const docs = [
      { documentType: "KALLELSE", parts: [P("a", "KALLELSE", 1, 1), P("a", "STAMNING", 2, 2)] },
      { documentType: "STAMNING" },
    ];
    expect(countKinds(docs).get("STAMNING")).toBe(2);
    expect(kindCountsByName(docs)).toEqual([{ type: "KALLELSE", count: 1 }, { type: "STAMNING", count: 2 }]);
  });
});
