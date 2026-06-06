/**
 * Tester för dokument-typ-filter i sök:
 *   1. Utan filter (tomt array eller undefined) → alla typer matchar.
 *   2. Med filter ["Dom"] → bara dokument med documentType "Dom".
 *   3. Med filter ["Dom", "Yttrande"] → båda typerna inkluderas.
 *   4. Filter på okänd typ → inga träffar.
 */

import { describe, it, expect } from "vitest";
import { searchDocuments } from "@/lib/server/adapters/demo-search-index";

const ORG = "demo-firma-ab";

const matters = new Map([
  ["m-1", { id: "m-1", matterNumber: "2026-0001", title: "X", organizationId: ORG }],
]);

const docs = [
  { id: "d1", organizationId: ORG, matterId: "m-1", fileName: "stamning.pdf", documentType: "Stämningsansökan", summary: "Lorem ipsum tvist" },
  { id: "d2", organizationId: ORG, matterId: "m-1", fileName: "dom.pdf",       documentType: "Dom",              summary: "Dom från tingsrätten gällande tvist" },
  { id: "d3", organizationId: ORG, matterId: "m-1", fileName: "yttrande.pdf",  documentType: "Yttrande",         summary: "Klientens yttrande tvist" },
];

describe("searchDocuments — documentTypes-filter", () => {
  it("utan filter returnerar träffar i alla typer", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, 50);
    const types = r.hits.map((h) => docs.find((d) => d.id === h.id)?.documentType);
    expect(types.sort()).toEqual(["Dom", "Stämningsansökan", "Yttrande"]);
  });

  it("filter ['Dom'] returnerar bara dom-träffar", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, 50, { documentTypes: ["Dom"] });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.id).toBe("d2");
  });

  it("filter ['Dom', 'Yttrande'] inkluderar båda", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, 50, { documentTypes: ["Dom", "Yttrande"] });
    const ids = r.hits.map((h) => h.id).sort();
    expect(ids).toEqual(["d2", "d3"]);
  });

  it("filter på okänd typ → inga träffar", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, 50, { documentTypes: ["FinnsEj"] });
    expect(r.hits).toHaveLength(0);
  });

  it("tom array → samma som inget filter (alla typer)", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, 50, { documentTypes: [] });
    expect(r.hits).toHaveLength(3);
  });

  // Facets — antal träffar PER typ, oavsett aktuellt type-filter.
  // Räknas alltid på fullständigt query-result så badges visar hur många
  // träffar varje filter SKULLE ge.
  it("facets innehåller alla typer som matchar query (utan type-filter)", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, 50);
    expect(r.facets?.documentTypes?.sort((a, b) => a.type.localeCompare(b.type)))
      .toEqual([
        { type: "Dom", count: 1 },
        { type: "Stämningsansökan", count: 1 },
        { type: "Yttrande", count: 1 },
      ]);
  });

  it("facets är samma även när type-filter är satt (badges = vad MAN SKULLE få)", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, 50, { documentTypes: ["Dom"] });
    // Hits begränsas till Dom (1 träff), men facets-counts visar att Yttrande
    // + Stämningsansökan SKULLE ge 1 träff vardera om man togglade dem.
    expect(r.hits).toHaveLength(1);
    expect(r.facets?.documentTypes?.length).toBe(3);
  });

  it("facets exkluderar dokument som inte matchar query alls", () => {
    const r = searchDocuments(docs, matters, "klientens", ORG, 50);
    // Bara d3 (Yttrande) har "klientens" i summary
    expect(r.facets?.documentTypes).toEqual([{ type: "Yttrande", count: 1 }]);
  });
});
