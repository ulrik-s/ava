/**
 * Tester för demo-lägets no-op-ports. Read-only-semantik: alla side-effect-
 * portar är tysta no-ops, och sök returnerar ett tomt men välformat svar.
 * Täcker hela `noopPorts`-aggregatet så att composition-root:en (DemoBootstrap)
 * kan wira in det utan överraskningar.
 */

import { describe, it, expect } from "vitest-compat";
import {
  noopEmail,
  noopDocumentAnalyzer,
  noopSearchIndex,
  noopPaymentScanner,
  noopContentStore,
  noopPorts,
} from "@/lib/server/adapters/noop-ports";

describe("noop-ports", () => {
  it("noopEmail.send är en tyst no-op", async () => {
    await expect(
      noopEmail.send({ to: "a@b.se", subject: "x", text: "y" }),
    ).resolves.toBeUndefined();
  });

  it("noopDocumentAnalyzer.analyze är en tyst no-op", async () => {
    await expect(noopDocumentAnalyzer.analyze("doc-1")).resolves.toBeUndefined();
  });

  it("noopSearchIndex.search returnerar tomt men välformat svar", async () => {
    const res = await noopSearchIndex.search("fråga", "org-1");
    expect(res.hits).toEqual([]);
    expect(res.estimatedTotalHits).toBe(0);
  });

  it("noopSearchIndex.upsert + remove är tysta no-ops", async () => {
    await expect(
      noopSearchIndex.upsert({
        id: "d1", fileName: "f.pdf", content: "c", matterId: "m1",
        matterNumber: "2026-0001", matterTitle: "T", organizationId: "org-1",
      }),
    ).resolves.toBeUndefined();
    await expect(noopSearchIndex.remove("d1")).resolves.toBeUndefined();
  });

  it("noopPaymentScanner.scan är en tyst no-op", async () => {
    await expect(noopPaymentScanner.scan("org-1")).resolves.toBeUndefined();
  });

  it("noopContentStore.write är en tyst no-op", async () => {
    await expect(
      noopContentStore.write("documents/content/d1.pdf", new Uint8Array([1, 2, 3])),
    ).resolves.toBeUndefined();
  });

  it("noopContentStore.read ger null (inget innehåll på servern)", async () => {
    await expect(noopContentStore.read("documents/content/d1.pdf")).resolves.toBeNull();
  });

  it("noopPorts aggregerar alla no-op-portar", () => {
    expect(noopPorts.email).toBe(noopEmail);
    expect(noopPorts.documentAnalyzer).toBe(noopDocumentAnalyzer);
    expect(noopPorts.searchIndex).toBe(noopSearchIndex);
    expect(noopPorts.paymentScanner).toBe(noopPaymentScanner);
    expect(noopPorts.content).toBe(noopContentStore);
  });
});
