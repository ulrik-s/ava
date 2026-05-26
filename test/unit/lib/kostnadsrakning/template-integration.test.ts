/**
 * Integrationstest: rendera HELA kostnadsräknings-default-mallen mot
 * buildKostnadsrakningContext för BÅDA taxa-utfallen och verifiera att
 * alla sektioner kommer med — inga obrutna {{tokens}} kvar.
 *
 * Bug: {{#if taxaApplies}}…{{else}}…{{/if}} renderades fel (else stöddes
 * inte) → för frångångstaxa (HUF>225, taxa-applies=false) försvann hela
 * blocket → "många saker kommer inte med i PDF:en".
 */

import { describe, it, expect } from "vitest";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { buildKostnadsrakningContext } from "@/lib/shared/kostnadsrakning";
import { KOSTNADSRAKNING_DEFAULT_HTML } from "@/lib/shared/kostnadsrakning-template";

const BASE = {
  matter: { matterNumber: "2026-0017", title: "Brottmål – omfattande utredning Davidsson", clientName: "David Davidsson" },
  defender: { name: "Anna Advokat", email: "anna@ava.demo" },
  organization: { name: "Demo Advokatbyrå AB", orgNumber: "556-1", address: "Storgatan 1" },
  courtName: "Stockholms tingsrätt",
  expenses: [
    { id: "e1", date: "2026-05-01", description: "Tåg", amount: 4500, vatRate: 600, vatIncluded: true, billable: true },
    { id: "e2", date: "2026-05-02", description: "Översättning", amount: 28000, vatRate: 2500, vatIncluded: true, billable: true },
  ],
};

function renderFull(hufMinutes: number) {
  const start = new Date("2026-05-20T09:00:00");
  const end = new Date(start.getTime() + hufMinutes * 60_000);
  const ctx = buildKostnadsrakningContext({
    ...BASE,
    hufStart: start,
    hufEnd: end,
    taxaLevel: 1,
    hasFTax: true,
  });
  return { html: renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, ctx.templateContext), ctx };
}

describe("kostnadsräknings-mall — full rendering", () => {
  it("taxa-applies (HUF 120 min): alla sektioner + inga obrutna tokens", () => {
    const { html } = renderFull(120);
    expect(html).not.toMatch(/\{\{/);       // inga orenderade variabler
    expect(html).not.toContain("{{else}}");
    expect(html).toContain("2026-0017");
    expect(html).toContain("Anna Advokat");
    expect(html).toContain("Demo Advokatbyrå AB");
    expect(html).toContain("Stockholms tingsrätt");
    // Utläggsrader (each) kom med
    expect(html).toContain("Tåg");
    expect(html).toContain("Översättning");
  });

  it("exceeds-max / frångångstaxa (HUF 300 min): else-grenen kommer med", () => {
    const { html, ctx } = renderFull(300);
    expect(ctx.templateContext.taxaApplies).toBe(false);
    // KRITISKT: hela dokumentet får inte försvinna — matterNumber, defender,
    // utläggsrader ska fortfarande renderas (else-grenen / sektioner utanför if).
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain("2026-0017");
    expect(html).toContain("Anna Advokat");
    expect(html).toContain("Tåg");
    expect(html).toContain("Översättning");
    // Dokumentet ska ha rimlig längd (inte tomt/avkapat)
    expect(html.length).toBeGreaterThan(500);
  });

  it("utan utlägg: each-blocket ger inga rader men resten renderas", () => {
    const start = new Date("2026-05-20T09:00:00");
    const ctx = buildKostnadsrakningContext({
      ...BASE, expenses: [],
      hufStart: start, hufEnd: new Date(start.getTime() + 120 * 60_000),
      taxaLevel: 1, hasFTax: true,
    });
    const html = renderHandlebars(KOSTNADSRAKNING_DEFAULT_HTML, ctx.templateContext);
    expect(html).not.toMatch(/\{\{/);
    expect(html).toContain("2026-0017");
  });
});
