/**
 * Fältprojektionen för MCP-ytans listverktyg (#1014).
 *
 * Poängen med tillåtlistan är att ett nytt join-fält i routern INTE ska läcka
 * ut i modellens svar och tyst äta budgeten. Testerna vaktar båda riktningarna:
 * att det som projiceras bort faktiskt försvinner, och att det svarskontrakten
 * utlovar finns kvar (ett bortprojicerat kontraktsfält fäller anropet, eftersom
 * SDK:n validerar `structuredContent` mot schemat).
 */

import { describe, it, expect } from "vitest-compat";
import { projectToolResult, projectedPaths, projectionFor } from "../../../tooling/ava-cli/tool-projections";

describe("projectToolResult", () => {
  it("behåller de vitlistade fälten och släpper join-fälten", () => {
    const res = projectToolResult("invoice.list", {
      items: [{
        id: "inv-1", invoiceNumber: "F-2026-0001", status: "SENT", amount: 1000,
        matter: { id: "m-1", title: "Ett långt ärende", contacts: [{ id: "c-1" }] },
        creditedInvoice: { id: "inv-0", amount: 500 },
      }],
      total: 42,
    }) as { items: Record<string, unknown>[]; total: number };

    expect(Object.keys(res.items[0]!).sort()).toEqual(["amount", "id", "invoiceNumber", "status"]);
    expect(res.items[0]).not.toHaveProperty("matter");
    expect(res.items[0]).not.toHaveProperty("creditedInvoice");
  });

  it("rör inte kuvertets övriga fält — `total` är hela poängen", () => {
    const res = projectToolResult("invoice.list", { items: [], total: 42 }) as { total: number };
    expect(res.total).toBe(42);
  });

  it("bevarar extra kuvertfält (pages, totalAmount)", () => {
    const res = projectToolResult("expense.list", {
      expenses: [{ id: "e-1", amount: 5, matter: { title: "X" } }],
      total: 3, totalAmount: 15, pages: 1,
    }) as Record<string, unknown>;
    expect({ total: res.total, totalAmount: res.totalAmount, pages: res.pages })
      .toEqual({ total: 3, totalAmount: 15, pages: 1 });
  });

  it("läser rätt array-nyckel för de äldre kuvertlistorna", () => {
    const res = projectToolResult("matter.list", {
      matters: [{ id: "m-1", matterNumber: "2026-0001", title: "T", status: "ACTIVE", paymentMethod: "PRIVAT", contacts: [1, 2, 3] }],
      total: 1,
    }) as { matters: Record<string, unknown>[] };
    expect(res.matters[0]).not.toHaveProperty("contacts");
    expect(res.matters[0]?.matterNumber).toBe("2026-0001");
  });

  it("saknade fält utelämnas i stället för att null:as", () => {
    // En null-rad ljuger: den påstår att fältet finns och är tomt.
    const res = projectToolResult("task.list", { items: [{ id: "t-1" }], total: 1 }) as { items: Record<string, unknown>[] };
    expect(res.items[0]).toEqual({ id: "t-1" });
  });

  it("passerar okända paths orörda", () => {
    const data = { anything: [{ deep: { nested: true } }] };
    expect(projectToolResult("matter.getById", data)).toBe(data);
  });

  it("passerar svar där nyckeln inte bär en array", () => {
    const data = { items: "inte en array", total: 0 };
    expect(projectToolResult("invoice.list", data)).toBe(data);
  });

  it("klarar null och primitiver utan att kasta", () => {
    expect(projectToolResult("invoice.list", null)).toBeNull();
    expect(projectToolResult("invoice.list", 5)).toBe(5);
  });
});

describe("projektionerna och svarskontrakten hänger ihop", () => {
  // Kontrakten valideras mot `structuredContent`; projiceras ett utlovat fält
  // bort fäller anropet. Paren hålls därför ihop här i st.f. i två filer.
  const CONTRACT_FIELDS: Readonly<Record<string, readonly string[]>> = {
    "invoice.list": ["id", "invoiceNumber", "status", "amount", "matterId"],
    "task.list": ["id", "title", "status"],
    "paymentPlan.list": ["id", "invoiceId", "status"],
    "matter.list": ["id", "matterNumber", "title", "status", "paymentMethod"],
    "timeEntry.list": ["id", "matterId", "date", "minutes", "description", "billable"],
  };

  for (const [path, required] of Object.entries(CONTRACT_FIELDS)) {
    it(`${path} projicerar inte bort sitt kontraktsfält`, () => {
      const fields = projectionFor(path)?.fields;
      expect(fields, `${path} saknar projektion`).toBeDefined();
      for (const f of required) expect(fields, `${path}.${f}`).toContain(f);
    });
  }

  it("alla projicerade paths är listverktyg", () => {
    for (const p of projectedPaths()) expect(p).toMatch(/\.list$/);
  });
});
