/**
 * Tester för dokument-typ-filter i sök:
 *   1. Utan filter (tomt array eller undefined) → alla typer matchar.
 *   2. Med filter ["DOM"] → bara dokument med typen DOM (ADR 0038).
 *   3. Med filter ["DOM", "INLAGA"] → båda typerna inkluderas.
 *   4. Filter på okänd typ → inga träffar.
 */

import { describe, it, expect } from "vitest-compat";
import { searchDocuments } from "@/lib/server/adapters/demo-search-index";

const ORG = "demo-firma-ab";

const matters = new Map([
  ["m-1", { id: "m-1", matterNumber: "2026-0001", title: "X", organizationId: ORG }],
]);

const docs = [
  { id: "d1", organizationId: ORG, matterId: "m-1", fileName: "stamning.pdf", kinds: ["STAMNING"], summary: "Lorem ipsum tvist" },
  { id: "d2", organizationId: ORG, matterId: "m-1", fileName: "dom.pdf",       kinds: ["DOM"],      summary: "Dom från tingsrätten gällande tvist" },
  { id: "d3", organizationId: ORG, matterId: "m-1", fileName: "yttrande.pdf",  kinds: ["INLAGA"],   summary: "Klientens yttrande tvist" },
];

describe("searchDocuments — documentTypes-filter", () => {
  it("utan filter returnerar träffar i alla typer", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50 });
    const types = r.hits.map((h) => docs.find((d) => d.id === h.id)?.kinds[0]);
    expect(types.sort()).toEqual(["DOM", "INLAGA", "STAMNING"]);
  });

  it("filter ['DOM'] returnerar bara dom-träffar", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50, documentTypes: ["DOM"] });
    expect(r.hits).toHaveLength(1);
    expect(r.hits[0]!.id).toBe("d2");
  });

  it("filter ['DOM', 'INLAGA'] inkluderar båda", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50, documentTypes: ["DOM", "INLAGA"] });
    const ids = r.hits.map((h) => h.id).sort();
    expect(ids).toEqual(["d2", "d3"]);
  });

  it("filter på okänd typ → inga träffar", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50, documentTypes: ["FinnsEj"] });
    expect(r.hits).toHaveLength(0);
  });

  it("tom array → samma som inget filter (alla typer)", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50, documentTypes: [] });
    expect(r.hits).toHaveLength(3);
  });

  // Facets — antal träffar PER typ, oavsett aktuellt type-filter.
  // Räknas alltid på fullständigt query-result så badges visar hur många
  // träffar varje filter SKULLE ge.
  it("facets innehåller alla typer som matchar query (utan type-filter)", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50 });
    expect(r.facets?.documentTypes?.sort((a, b) => a.type.localeCompare(b.type)))
      .toEqual([
        { type: "DOM", count: 1 },
        { type: "INLAGA", count: 1 },
        { type: "STAMNING", count: 1 },
      ]);
  });

  it("facets är samma även när type-filter är satt (badges = vad MAN SKULLE få)", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50, documentTypes: ["DOM"] });
    // Hits begränsas till Dom (1 träff), men facets-counts visar att Yttrande
    // + Stämningsansökan SKULLE ge 1 träff vardera om man togglade dem.
    expect(r.hits).toHaveLength(1);
    expect(r.facets?.documentTypes?.length).toBe(3);
  });

  it("facets exkluderar dokument som inte matchar query alls", () => {
    const r = searchDocuments(docs, matters, "klientens", ORG, { limit: 50 });
    // Bara d3 (inlagan) har "klientens" i summary
    expect(r.facets?.documentTypes).toEqual([{ type: "INLAGA", count: 1 }]);
  });
});

describe("searchDocuments — ärende-filter + sida (#1215)", () => {
  const twoMatters = new Map([
    ...matters,
    ["m-2", { id: "m-2", matterNumber: "2026-0002", title: "Y", organizationId: ORG }],
  ]);
  const withOther = [...docs, { id: "d4", organizationId: ORG, matterId: "m-2", fileName: "tvist.pdf", kinds: ["DOM"], summary: null }];

  it("matterId begränsar både träffar och facetter till ärendet", () => {
    const r = searchDocuments(withOther, twoMatters, "tvist", ORG, { limit: 50, matterId: "m-2" });
    expect(r.hits.map((h) => h.id)).toEqual(["d4"]);
    expect(r.facets?.documentTypes).toEqual([{ type: "DOM", count: 1 }]);
  });

  it("utan matterId söks hela byrån", () => {
    expect(searchDocuments(withOther, twoMatters, "tvist", ORG, { limit: 50 }).hits).toHaveLength(4);
  });

  it("demons innehåll är sidlöst → page är null", () => {
    const r = searchDocuments(docs, matters, "tvist", ORG, { limit: 50 });
    expect(r.hits.every((h) => h.page === null)).toBe(true);
  });
});

describe("searchDocuments — typernas visningsnamn (ADR 0038)", () => {
  const typed = [
    { id: "f1", organizationId: ORG, matterId: "m-1", fileName: "scan_01.pdf", kinds: ["FORORDNANDE", "Sekretess"], summary: null },
    { id: "f2", organizationId: ORG, matterId: "m-1", fileName: "scan_02.pdf", documentType: "Kostnadsräkning", summary: null },
  ];

  it("fritext matchar visningsnamnet (Förordnande), egna typer och äldre rader", () => {
    expect(searchDocuments(typed, matters, "förordnande", ORG, { limit: 50 }).hits.map((h) => h.id)).toEqual(["f1"]);
    expect(searchDocuments(typed, matters, "sekretess", ORG, { limit: 50 }).hits.map((h) => h.id)).toEqual(["f1"]);
    expect(searchDocuments(typed, matters, "kostnadsräkning", ORG, { limit: 50 }).hits.map((h) => h.id)).toEqual(["f2"]);
  });

  it("filtret träffar en äldre rad via läsregeln", () => {
    expect(searchDocuments(typed, matters, "scan", ORG, { limit: 50, documentTypes: ["KOSTNADSRAKNING"] }).hits.map((h) => h.id)).toEqual(["f2"]);
  });
});
