/**
 * Tester för pure-funktion `searchDocuments` i demo-search-index.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { searchDocuments } from "@/server/adapters/demo-search-index";
import { setDocumentContent, clearDocumentContentCache } from "@/client/lib/demo/document-content-cache";

beforeEach(() => clearDocumentContentCache());

const docs = [
  { id: "d-1", fileName: "Stämningsansökan vårdnad.pdf", documentType: "Stämningsansökan", summary: "Ensam vårdnad om dotter", matterId: "m-1", organizationId: "org-1" },
  { id: "d-2", fileName: "Dom tingsrätten.pdf", documentType: "Dom", summary: "Vårdnad bifölls", matterId: "m-1", organizationId: "org-1" },
  { id: "d-3", fileName: "Bouppteckning.pdf", documentType: "Bouppteckning", summary: "Arvskifte efter Eriksson", matterId: "m-2", organizationId: "org-1" },
  { id: "d-other", fileName: "Hemlig.pdf", documentType: "Yttrande", summary: "annan org", matterId: "m-other", organizationId: "org-other" },
];

const matters = new Map([
  ["m-1", { id: "m-1", matterNumber: "2026-001", title: "Vårdnad" }],
  ["m-2", { id: "m-2", matterNumber: "2026-002", title: "Arvskifte" }],
  ["m-other", { id: "m-other", matterNumber: "X", title: "X" }],
]);

describe("searchDocuments", () => {
  it("matchar mot fileName (case-insensitive)", () => {
    const r = searchDocuments(docs, matters, "vårdnad", "org-1", 20);
    expect(r.hits.length).toBe(2); // d-1 (fileName+summary), d-2 (summary)
    expect(r.hits.map((h) => h.id)).toContain("d-1");
    expect(r.hits.map((h) => h.id)).toContain("d-2");
  });

  it("matchar mot documentType", () => {
    const r = searchDocuments(docs, matters, "stämning", "org-1", 20);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits[0].id).toBe("d-1");
  });

  it("matchar mot summary", () => {
    const r = searchDocuments(docs, matters, "Eriksson", "org-1", 20);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].id).toBe("d-3");
  });

  it("filtrerar bort dokument från annan org", () => {
    const r = searchDocuments(docs, matters, "Hemlig", "org-1", 20);
    expect(r.hits.length).toBe(0);
  });

  it("tomt query → inga träffar", () => {
    expect(searchDocuments(docs, matters, "", "org-1", 20).hits).toEqual([]);
    expect(searchDocuments(docs, matters, "   ", "org-1", 20).hits).toEqual([]);
  });

  it("inkluderar matter-info i resultat", () => {
    const r = searchDocuments(docs, matters, "Stämningsansökan", "org-1", 20);
    expect(r.hits[0].matterNumber).toBe("2026-001");
    expect(r.hits[0].matterTitle).toBe("Vårdnad");
  });

  it("respekterar limit", () => {
    const r = searchDocuments(docs, matters, "pdf", "org-1", 1);
    // Inte alla matchar "pdf" eftersom det är ej i fileName/type/summary normalt
    expect(r.hits.length).toBeLessThanOrEqual(1);
  });

  it("ranking: fileName-träff prioriteras över summary-träff", () => {
    // "vårdnad" finns i d-1.fileName + d-1.summary + d-2.summary
    // d-1 ska ranka högst eftersom det har träff i både fileName + summary
    const r = searchDocuments(docs, matters, "vårdnad", "org-1", 20);
    expect(r.hits[0].id).toBe("d-1");
  });

  it("hittar ord som ENDAST finns i dokumentinnehåll (content-cache)", () => {
    // Inget av docs har "skadan" i metadata, men vi cachar det i content
    setDocumentContent("d-3", "BRF beslutar avslag pga att skadan inte är dokumenterad.");
    const r = searchDocuments(docs, matters, "skadan", "org-1", 20);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].id).toBe("d-3");
    // Snippet ska innehålla kontext runt query
    expect(r.hits[0]._formatted?.content).toContain("skadan");
  });

  it("content-träff genererar snippet med ellipsis runt query", () => {
    setDocumentContent("d-3",
      "Detta är ett mycket långt dokument med information om olika saker, " +
      "och någonstans i mitten finns ordet TARGET som vi söker efter, " +
      "och sedan fortsätter det med ännu mer information som inte är relevant."
    );
    const r = searchDocuments(docs, matters, "target", "org-1", 20);
    expect(r.hits.length).toBe(1);
    const snippet = r.hits[0]._formatted?.content ?? "";
    expect(snippet).toContain("TARGET");
    expect(snippet).toMatch(/^…/);
    expect(snippet).toMatch(/…$/);
  });

  it("kombinerar metadata- + content-träff (boost-summa)", () => {
    setDocumentContent("d-1", "innehåller också vårdnad-text");
    const r = searchDocuments(docs, matters, "vårdnad", "org-1", 20);
    expect(r.hits[0].id).toBe("d-1");
    // d-1 har: fileName(2) + summary(1) + content(1) + meta(1) = 5
    // d-2 har: summary(1) + meta(1) = 2
  });
});
