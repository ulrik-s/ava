/**
 * Tester för pure-funktion `searchDocuments` i demo-search-index.
 */

import { describe, it, expect, beforeEach } from "vitest-compat";
import { setDocumentContent, clearDocumentContentCache } from "@/lib/client/demo/document-content-cache";
import { searchDocuments, compileNeedle } from "@/lib/server/adapters/demo-search-index";

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
    expect(r.hits[0]!.id).toBe("d-1");
  });

  it("matchar mot summary", () => {
    const r = searchDocuments(docs, matters, "Eriksson", "org-1", 20);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]!.id).toBe("d-3");
  });

  it("filtrerar bort dokument från annan org", () => {
    const r = searchDocuments(docs, matters, "Hemlig", "org-1", 20);
    expect(r.hits.length).toBe(0);
  });

  // Regression: i riktig git-db saknar documents `organizationId`-fält —
  // de scopas via sin matter. Söket måste resolvea org-id via matter-lookup.
  it("scopar via matter.organizationId när doc saknar fältet", () => {
    const docsWithoutOrg = [
      { id: "d-a", fileName: "Note A.md", documentType: null, summary: null, matterId: "m-firma" },
      { id: "d-b", fileName: "Note B.md", documentType: null, summary: null, matterId: "m-extern" },
    ] as unknown as Parameters<typeof searchDocuments>[0];
    const mattersByOrg = new Map([
      ["m-firma", { id: "m-firma", matterNumber: "F-1", title: "Internt", organizationId: "firma-ab" }],
      ["m-extern", { id: "m-extern", matterNumber: "E-1", title: "Extern", organizationId: "other-org" }],
    ]) as unknown as Parameters<typeof searchDocuments>[1];
    const r = searchDocuments(docsWithoutOrg, mattersByOrg, "Note", "firma-ab", 20);
    expect(r.hits.map((h) => h.id)).toEqual(["d-a"]);
  });

  it("tomt query → inga träffar", () => {
    expect(searchDocuments(docs, matters, "", "org-1", 20).hits).toEqual([]);
    expect(searchDocuments(docs, matters, "   ", "org-1", 20).hits).toEqual([]);
  });

  it("inkluderar matter-info i resultat", () => {
    const r = searchDocuments(docs, matters, "Stämningsansökan", "org-1", 20);
    expect(r.hits[0]!.matterNumber).toBe("2026-001");
    expect(r.hits[0]!.matterTitle).toBe("Vårdnad");
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
    expect(r.hits[0]!.id).toBe("d-1");
  });

  it("hittar ord som ENDAST finns i dokumentinnehåll (content-cache)", () => {
    // Inget av docs har "skadan" i metadata, men vi cachar det i content
    setDocumentContent("d-3", "BRF beslutar avslag pga att skadan inte är dokumenterad.");
    const r = searchDocuments(docs, matters, "skadan", "org-1", 20);
    expect(r.hits.length).toBe(1);
    expect(r.hits[0]!.id).toBe("d-3");
    // Snippet ska innehålla kontext runt query
    expect(r.hits[0]!._formatted?.content).toContain("skadan");
  });

  it("content-träff genererar snippet med ellipsis runt query", () => {
    setDocumentContent("d-3",
      "Detta är ett mycket långt dokument med information om olika saker, " +
      "och någonstans i mitten finns ordet TARGET som vi söker efter, " +
      "och sedan fortsätter det med ännu mer information som inte är relevant."
    );
    const r = searchDocuments(docs, matters, "target", "org-1", 20);
    expect(r.hits.length).toBe(1);
    const snippet = r.hits[0]!._formatted?.content ?? "";
    expect(snippet).toContain("TARGET");
    expect(snippet).toMatch(/^…/);
    expect(snippet).toMatch(/…$/);
  });

  it("kombinerar metadata- + content-träff (boost-summa)", () => {
    setDocumentContent("d-1", "innehåller också vårdnad-text");
    const r = searchDocuments(docs, matters, "vårdnad", "org-1", 20);
    expect(r.hits[0]!.id).toBe("d-1");
    // d-1 har: fileName(2) + summary(1) + content(1) + meta(1) = 5
    // d-2 har: summary(1) + meta(1) = 2
  });

  // ─── Wildcard (*) ────────────────────────────────────────────────────
  describe("wildcard *", () => {
    it("'stäm*' matchar 'Stämningsansökan'", () => {
      const r = searchDocuments(docs, matters, "stäm*", "org-1", 20);
      expect(r.hits.map((h) => h.id)).toContain("d-1");
    });

    it("'*ansökan*' matchar i mitten av ord", () => {
      const r = searchDocuments(docs, matters, "*ansökan*", "org-1", 20);
      expect(r.hits.map((h) => h.id)).toContain("d-1");
    });

    it("'dom*tings*' matchar flera ord i ordning", () => {
      const r = searchDocuments(docs, matters, "dom*tings*", "org-1", 20);
      expect(r.hits.map((h) => h.id)).toContain("d-2");
    });

    it("ren prefix utan * fungerar fortsatt (substring)", () => {
      const r = searchDocuments(docs, matters, "vårdnad", "org-1", 20);
      expect(r.hits.map((h) => h.id)).toContain("d-1");
    });

    it("* i content-cache matchas och ger snippet", () => {
      setDocumentContent("d-3", "Vid arvskiftet upptäcktes att testamentet var ogiltigt.");
      const r = searchDocuments(docs, matters, "testa*", "org-1", 20);
      expect(r.hits.map((h) => h.id)).toContain("d-3");
      const snippet = r.hits.find((h) => h.id === "d-3")?._formatted?.content ?? "";
      expect(snippet).toContain("testamentet");
    });

    it("regex-metachars i query escapas (.+ ska INTE matcha annat)", () => {
      // ".+" som literal sträng finns inte i någon doc → inga träffar.
      const r = searchDocuments(docs, matters, ".+", "org-1", 20);
      expect(r.hits).toEqual([]);
    });

    it("'*' ensamt matchar allt (om q inte är tomt)", () => {
      const r = searchDocuments(docs, matters, "*", "org-1", 20);
      // Alla 3 doks i org-1 ska träffas
      expect(r.hits.length).toBe(3);
    });
  });
});

describe("compileNeedle", () => {
  it("utan * → tester via includes (case-insensitive)", () => {
    const m = compileNeedle("hello");
    expect(m.test("Hello world")).toBe(true);
    expect(m.test("nope")).toBe(false);
  });

  it("med * → tester via regex", () => {
    const m = compileNeedle("hej*värld");
    expect(m.test("hej snabba värld")).toBe(true);
    expect(m.test("värld utan prefix")).toBe(false);
  });

  it("escapar regex-metachars", () => {
    const m = compileNeedle("a.b");
    // "a.b" som literal → INTE "aXb"
    expect(m.test("a.b här")).toBe(true);
    expect(m.test("aXb här")).toBe(false);
  });

  it("hasWildcard-flaggan exponerad", () => {
    expect(compileNeedle("plain").hasWildcard).toBe(false);
    expect(compileNeedle("p*n").hasWildcard).toBe(true);
  });
});
