/**
 * Faktura-dokument: ett genererat FAKTURA-dokument per FINAL-faktura,
 * kopplat till fakturan (invoiceId) → syns under inv.documents i detaljen.
 */

import { describe, it, expect } from "vitest-compat";
import { buildSeed } from "../../tooling/scripts/seed-data";
import { createGitTarget } from "../../tooling/demo-generator/backend-target";
import { populate } from "../../tooling/demo-generator/populate";
import { populateBilling } from "../../tooling/demo-generator/populate-billing";
import { populateInvoiceDocs } from "../../tooling/demo-generator/populate-invoice-docs";

const ADMIN = { id: "gen", email: "g@a.se", name: "G", role: "ADMIN", organizationId: "firma-ab" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

describe("populateInvoiceDocs", () => {
  it("genererar ett faktura-dokument per FINAL-faktura, länkat via invoiceId", async () => {
    const seed = buildSeed();
    const writes: string[] = [];
    const target = createGitTarget({ principal: ADMIN, writeBack: async () => {} });
    await populate(target.caller, seed);
    await populateBilling(target.caller, seed);

    const n = await populateInvoiceDocs(target.caller, (p, b) => { writes.push(p); return b.byteLength; });
    expect(n).toBeGreaterThan(0);
    expect(writes.every((p) => p.startsWith("documents/content/invdoc-") && p.endsWith(".html"))).toBe(true);

    const invoices: Any[] = await (target.caller as Any).invoice.list({});
    const final = invoices.find((i: Any) => i.invoiceType === "FINAL");
    expect(final).toBeDefined();
    const inv = await (target.caller as Any).invoice.getById({ id: final.id });
    expect(inv.documents.length).toBeGreaterThan(0); // länkat dokument syns på fakturan
    expect(inv.documents[0].documentType).toBe("Faktura");
    expect(inv.documents[0].invoiceId).toBe(final.id);
    expect(String(inv.documents[0].fileName)).toContain("Faktura");
  });
});
