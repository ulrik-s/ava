/**
 * Tester för `entityHref` — den static-export-säkra länk-byggaren som låter
 * navigering till runtime-skapade (ej pre-renderade) entitets-id:n fungera via
 * hård `<a href>`-navigering + 404-shim istället för Next-`<Link>` (→ #418).
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { entityHref, shellPath } from "@/lib/client/demo/entity-href";

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

  it("sub-segment hanterar nästlade routes (templates/<id>/edit)", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "/ava");
    expect(entityHref("templates", "t1", "edit")).toBe("/ava/templates/t1/edit/");
  });

  it("normaliserar sub med ledande/avslutande slash", () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_BASE_PATH", "");
    expect(entityHref("templates", "t1", "/edit/")).toBe("/templates/t1/edit/");
  });
});

describe("shellPath (soft-nav till __shell__ med ?id)", () => {
  it("bygger route-relativ __shell__-path med id som query (ingen base-path)", () => {
    // Ingen base-path: Next:s <Link>/router lägger på den själv.
    expect(shellPath("invoices", "inv-1")).toBe("/invoices/__shell__/?id=inv-1");
    expect(shellPath("matters", "m-1")).toBe("/matters/__shell__/?id=m-1");
  });

  it("hanterar nästlad route (templates/__shell__/edit/)", () => {
    expect(shellPath("templates", "t-1", "edit")).toBe("/templates/__shell__/edit/?id=t-1");
  });

  it("URL-enkodar id:t", () => {
    expect(shellPath("invoices", "a/b c")).toBe("/invoices/__shell__/?id=a%2Fb%20c");
  });

  it("pekar ALDRIG direkt på /<route>/<id> (soft-nav dit → React #418)", () => {
    expect(shellPath("invoices", "inv-1")).not.toMatch(/\/invoices\/inv-1(\/|\?|$)/);
  });
});
