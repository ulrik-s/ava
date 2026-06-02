/**
 * Tester för `entityHref` — den static-export-säkra länk-byggaren som låter
 * navigering till runtime-skapade (ej pre-renderade) entitets-id:n fungera via
 * hård `<a href>`-navigering + 404-shim istället för Next-`<Link>` (→ #418).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { entityHref } from "@/lib/client/demo/entity-href";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("entityHref", () => {
  it("prefixar base-path och avslutar med trailing slash (GH Pages)", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "/ava");
    expect(entityHref("invoices", "abc-123")).toBe("/ava/invoices/abc-123/");
  });

  it("utan base-path (self-hosted) ger absolut rot-path", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "");
    expect(entityHref("invoices", "abc-123")).toBe("/invoices/abc-123/");
  });

  it("normaliserar route med ledande/avslutande slash", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "/ava");
    expect(entityHref("/invoices/", "x")).toBe("/ava/invoices/x/");
  });

  it("fungerar för andra entiteter (payment-plans, matters)", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "/ava");
    expect(entityHref("payment-plans", "p1")).toBe("/ava/payment-plans/p1/");
    expect(entityHref("matters", "m1")).toBe("/ava/matters/m1/");
  });
});
