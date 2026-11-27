/**
 * Regressionsskydd: dokumentmall-generering måste fungera KLIENTSIDIGT
 * (demo/static-export har ingen /api/templates/generate-route → 404).
 *
 * Bug: GenerateModal anropade fetch("/api/templates/generate") → 404 i
 * demo → "Generering misslyckades". Nu renderas mallen i browsern via
 * buildTemplateContext + renderHandlebars.
 *
 * Kontexten (#2118) byggs ur frågornas data: ärendet, byrån, kontoren, den
 * inloggade och mottagarens kontakt-id. Inga anteckningar följer med.
 */

import { describe, it, expect } from "vitest-compat";
import { renderHandlebars } from "@/lib/client/kostnadsrakning/render-handlebars";
import { buildTemplateContext } from "@/lib/client/templates/build-template-context";
import { FULL, NOW, matter } from "../../../helpers/template-context-fixture";

describe("buildTemplateContext — ett fullt ifyllt ärende (#2118)", () => {
  const ctx = buildTemplateContext(FULL);

  it("ärendet: beskrivning, status som etikett och skapat datum i svensk tid", () => {
    expect(ctx.matter).toEqual({
      matterNumber: "2026-0001", title: "Vårdnadstvist", matterType: "Familjerätt",
      description: "Tvist om vårdnad", status: "Aktivt", createdAt: "2026-03-15",
    });
    expect(ctx.today).toBe("2026-01-01");
  });

  it("byrån: telefon, bankgiro, huvudkontoret och kontoren i listans ordning", () => {
    expect(ctx.organization).toEqual({
      name: "Demo Advokatbyrå", orgNumber: "556-1", address: "Byråvägen 3", email: "info@byra.se", phone: "08-123", bankgiro: "123-4567",
      mainOffice: { name: "Lund", address: "Lundavägen 2" },
      offices: [
        { name: "Malmö", address: "Malmövägen 1", phone: "040-1" },
        { name: "Lund", address: "Lundavägen 2", phone: "046-2" },
      ],
    });
  });

  it("klient (med client som samma objekt) och motpart", () => {
    expect(ctx.klient).toEqual({ name: "Anna Andersson", personalNumber: "19800101-1234", address: "Storgatan 1", phone: "070-1", email: "anna@x.se" });
    expect(ctx.client).toBe(ctx.klient);
    expect(ctx.motpart).toEqual({ name: "Bo Berg" });
  });

  it("mottagaren: adress och rollens etikett, utan rollkod", () => {
    expect(ctx.recipient).toEqual({
      name: "Bo Berg", email: "bo@x.se", phone: "", address: "Lillgatan 2", personalNumber: "", orgNumber: "", roleLabel: "Motpart",
    });
  });

  it("parterna: en rad per koppling med sin roll", () => {
    expect(ctx.contacts).toEqual([
      { name: "Anna Andersson", roleLabel: "Klient" },
      { name: "Bo Berg", roleLabel: "Motpart" },
      { name: "Bo Berg", roleLabel: "Vittne" },
    ]);
  });

  it("genererat av: den inloggade med titel", () => {
    expect(ctx.generatedBy).toEqual({ name: "Karin Advokat", title: "Advokat" });
  });

  it("inga anteckningar någonstans i kontexten", () => {
    expect(JSON.stringify(ctx)).not.toContain("notes");
    expect(JSON.stringify(ctx)).not.toContain("anteckning");
  });
});

describe("buildTemplateContext — tomma fall", () => {
  const ctx = buildTemplateContext({
    matter: matter({ contacts: [], description: null, matterType: null, status: "ARCHIVED" }),
    offices: [{ name: "Malmö" }],
    user: { name: "Karin Advokat", title: null },
    now: NOW,
  });

  it("ingen mottagare, klient eller motpart: null", () => {
    expect(ctx.recipient).toBeNull();
    expect(ctx.klient).toBeNull();
    expect(ctx.client).toBeNull();
    expect(ctx.motpart).toBeNull();
    expect(ctx.contacts).toEqual([]);
  });

  it("inget huvudkontor, ingen byrå och ingen titel: tomt", () => {
    expect(ctx.organization.mainOffice).toBeNull();
    expect(ctx.organization.offices).toEqual([{ name: "Malmö", address: "", phone: "" }]);
    expect(ctx.organization.name).toBe("");
    expect(ctx.generatedBy).toEqual({ name: "Karin Advokat", title: "" });
    expect(ctx.matter).toMatchObject({ description: "", matterType: "", status: "Arkiverat" });
  });

  it("utan inloggad användare: generatedBy null", () => {
    expect(buildTemplateContext({ matter: matter(), now: NOW }).generatedBy).toBeNull();
  });
});

describe("buildTemplateContext — today", () => {
  it("today är den svenska dagen — nyårsnatten 00:30 (23:30 UTC) är den 1 januari (#1677)", () => {
    const ctx = buildTemplateContext({ matter: matter(), now: new Date("2025-12-31T23:30:00Z") });
    expect(ctx.today).toBe("2026-01-01");
  });
});

describe("template-rendering (context + handlebars)", () => {
  it("renderar seed-mallens stämningsansökan korrekt", () => {
    const ctx = buildTemplateContext({ matter: matter(), now: NOW });
    const html = renderHandlebars("<h1>Stämningsansökan</h1><p>Mål nr: {{matter.matterNumber}}</p>", ctx);
    expect(html).toContain("Mål nr: 2026-0001");
    expect(html).not.toContain("{{");
  });

  it("renderar mottagaren, klienten via aliaset client och byrån", () => {
    const html = renderHandlebars(
      "<p>Till: {{recipient.name}}, {{recipient.address}}</p><p>{{client.name}} {{klient.email}}</p><footer>{{organization.phone}} · {{today}}</footer>",
      buildTemplateContext({ ...FULL, now: NOW }),
    );
    expect(html).toContain("Till: Bo Berg, Lillgatan 2");
    expect(html).toContain("Anna Andersson anna@x.se");
    expect(html).toContain("08-123 · 2026-05-26");
  });

  it("saknade uppgifter blir tomma, utan fel", () => {
    const html = renderHandlebars("<p>[{{motpart.name}}][{{organization.mainOffice.name}}][{{generatedBy.title}}]</p>",
      buildTemplateContext({ matter: matter({ contacts: [] }), now: NOW }));
    expect(html).toContain("[][][]");
  });
});
