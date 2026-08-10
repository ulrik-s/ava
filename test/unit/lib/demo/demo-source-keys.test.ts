/**
 * Tester för `pathToSourceKey` — path→DemoSource-nyckel-mappningen som
 * `loadDemoSeed` använder för att gruppera fetchade filer per entitet (#420).
 */

import { describe, it, expect } from "vitest-compat";
import { pathToSourceKey } from "@/lib/client/demo/demo-source-keys";
import { ENTITY_REGISTRY } from "@/lib/shared/schemas";

describe("pathToSourceKey", () => {
  it("mappar kärnentiteter till sina plural-nycklar", () => {
    expect(pathToSourceKey("matters/active/m1.json")).toBe("matters");
    expect(pathToSourceKey("matters/archive/2024/m2.json")).toBe("matters");
    expect(pathToSourceKey("contacts/c1.json")).toBe("contacts");
    expect(pathToSourceKey(".ava/users/u1.json")).toBe("users");
    expect(pathToSourceKey("matter-contacts/mc1.json")).toBe("matterContacts");
    expect(pathToSourceKey("invoices/i1.json")).toBe("invoices");
    expect(pathToSourceKey("time-entries/t1.json")).toBe("timeEntries");
  });

  it("dokument-metadata mappar till documents men content/text gör INTE", () => {
    expect(pathToSourceKey("documents/d1.json")).toBe("documents");
    expect(pathToSourceKey("documents/content/d1.pdf")).toBeNull();
    expect(pathToSourceKey("documents/text/d1.txt")).toBeNull();
  });

  it("mappar billing/kalender/preferens-entiteter", () => {
    expect(pathToSourceKey("billing-runs/b1.json")).toBe("billingRuns");
    expect(pathToSourceKey("acconto-deductions/a1.json")).toBe("accontoDeductions");
    expect(pathToSourceKey("calendar/e1.json")).toBe("calendarEvents");
    expect(pathToSourceKey("payment-plans/p1.json")).toBe("paymentPlans");
    expect(pathToSourceKey("payment-plan-reminders/r1.json")).toBe("paymentPlanReminders");
    // #982: saknades helt → varje avskrivning tappades tyst av demon, och
    // migrate-on-read (ADR 0007) täckte över det med en gissad ersättningspost.
    expect(pathToSourceKey("write-offs/w1.json")).toBe("writeOffs");
    // #985: utan dessa låg varje dokument i roten och utskickshistoriken var tom.
    expect(pathToSourceKey("document-folders/f1.json")).toBe("documentFolders");
    expect(pathToSourceKey("invoice-dispatches/d1.json")).toBe("invoiceDispatches");
    expect(pathToSourceKey(".ava/templates/t1.json")).toBe("documentTemplates");
    expect(pathToSourceKey(".ava/organizations/o1.json")).toBe("organizations");
    expect(pathToSourceKey(".ava/user-preferences/up1.json")).toBe("userPreferences");
    expect(pathToSourceKey(".ava/org-preferences/op1.json")).toBe("orgPreferences");
  });

  it("returnerar null för okända paths (meta.json, manifest)", () => {
    expect(pathToSourceKey(".ava/meta.json")).toBeNull();
    expect(pathToSourceKey("manifest.json")).toBeNull();
    expect(pathToSourceKey("README.md")).toBeNull();
  });
});

/**
 * Strukturell grind (#982). Listan ovan räknar upp entiteter en och en, och
 * missar därför den entitet ingen kom ihåg att lägga till — precis vad som hände
 * `write-offs/`: filerna skrevs, hamnade i manifestet, och släpptes sedan tyst av
 * loadern. Ingenting sa ifrån, eftersom migrate-on-read syntetiserade en
 * ersättningspost som fick ledgern att summera rätt.
 *
 * Testet nedan härleder i stället kravet ur `ENTITY_REGISTRY`, som redan bär
 * både `gitPrefix` och `sourceKey`. Ny entitet utan matcher → rött.
 */
describe("pathToSourceKey täcker ENTITY_REGISTRY", () => {
  /**
   * Entiteter som INTE hydreras i demon. Listan är en ratchet: den ska krympa,
   * aldrig växa, och varje rad kräver ett skäl.
   *
   * De två som är kvar (#985) har INGEN producent någonstans i kodbasen —
   * varken ett jobb eller en mutation skapar dem. `IDocumentAnalyzer.analyze`
   * lovar att "eventuella suggestions postas via
   * dataStore.documentAnalysisSuggestions", men ingen implementation gör det:
   * classify-pipelinen skriver bara `document.updateMetadata`. Följden är att
   * `SuggestionsPanel` och `EventsPanel` står tomma i ALLA tier, inte bara i
   * demon. Att koppla på en matcher här hade varit meningslöst, och att seeda
   * rader hade betytt data som appen själv aldrig kan producera. Gapet är
   * uppströms — se #988.
   */
  const NOT_YET_HYDRATED = new Set([
    "documentAnalysisSuggestion", "matterEventSuggestion",
  ]);

  it("varje registrerad entitets gitPrefix mappar till sin sourceKey", () => {
    const gaps: string[] = [];
    for (const [name, entry] of Object.entries(ENTITY_REGISTRY)) {
      if (NOT_YET_HYDRATED.has(name)) continue;
      const got = pathToSourceKey(`${entry.gitPrefix}/x.json`);
      if (got !== entry.sourceKey) gaps.push(`${name}: ${entry.gitPrefix}/ → ${got} (väntat ${entry.sourceKey})`);
    }
    expect(gaps, "entiteter vars filer loadern skulle släppa tyst").toEqual([]);
  });

  it("undantagslistan innehåller bara entiteter som faktiskt finns", () => {
    // Skydd mot att en rad blir kvar efter att entiteten tagits in eller bytt namn.
    for (const name of NOT_YET_HYDRATED) {
      const entry = ENTITY_REGISTRY[name as keyof typeof ENTITY_REGISTRY] as { gitPrefix: string } | undefined;
      expect(entry, `${name} finns i registret`).toBeDefined();
      expect(pathToSourceKey(`${entry?.gitPrefix ?? "saknas"}/x.json`)).toBeNull();
    }
  });
});
