/**
 * Regressionsskydd: dokumentmall-generering måste fungera KLIENTSIDIGT
 * (demo/static-export har ingen /api/templates/generate-route → 404).
 *
 * Bug: GenerateModal anropade fetch("/api/templates/generate") → 404 i
 * demo → "Generering misslyckades". Nu renderas mallen i browsern via
 * buildTemplateContext + renderHandlebars.
 */

import { describe, it, expect } from "vitest-compat";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { buildTemplateContext } from "@/lib/client/templates/build-template-context";

const NOW = new Date("2026-05-26T10:00:00Z");

describe("buildTemplateContext", () => {
  it("exponerar matter, recipient, client, organization, today", () => {
    const ctx = buildTemplateContext({
      matter: { matterNumber: "2026-0001", title: "Vårdnadstvist", matterType: "Familjerätt" },
      recipient: { name: "Anna Andersson", email: "anna@x.se" },
      client: { name: "Anna Andersson" },
      organization: { name: "Demo Advokatbyrå", orgNumber: "556-1" },
      now: NOW,
    });
    expect(ctx.today).toBe("2026-05-26");
    expect((ctx.matter as { matterNumber: string }).matterNumber).toBe("2026-0001");
    expect((ctx.recipient as { name: string }).name).toBe("Anna Andersson");
    expect((ctx.organization as { name: string }).name).toBe("Demo Advokatbyrå");
  });

  it("recipient = null när ingen mottagare angiven", () => {
    const ctx = buildTemplateContext({
      matter: { matterNumber: "2026-0002", title: "X" },
      now: NOW,
    });
    expect(ctx.recipient).toBeNull();
  });
});

describe("template-rendering (context + handlebars)", () => {
  it("renderar seed-mallens stämningsansökan korrekt", () => {
    const ctx = buildTemplateContext({
      matter: { matterNumber: "2026-0001", title: "Vårdnadstvist" },
      now: NOW,
    });
    const html = renderHandlebars("<h1>Stämningsansökan</h1><p>Mål nr: {{matter.matterNumber}}</p>", ctx);
    expect(html).toContain("Mål nr: 2026-0001");
    expect(html).not.toContain("{{");
  });

  it("renderar recipient-namn när mottagare finns", () => {
    const ctx = buildTemplateContext({
      matter: { matterNumber: "2026-0001", title: "X" },
      recipient: { name: "Björn Bergman" },
      now: NOW,
    });
    const html = renderHandlebars("<p>Till: {{recipient.name}}</p>", ctx);
    expect(html).toContain("Till: Björn Bergman");
  });

  it("renderar organisationsnamn + datum", () => {
    const ctx = buildTemplateContext({
      matter: { matterNumber: "2026-0001", title: "X" },
      organization: { name: "Demo AB" },
      now: NOW,
    });
    const html = renderHandlebars("<footer>{{organization.name}} · {{today}}</footer>", ctx);
    expect(html).toContain("Demo AB · 2026-05-26");
  });
});
