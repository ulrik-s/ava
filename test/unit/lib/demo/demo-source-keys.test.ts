/**
 * Tester för `pathToSourceKey` — path→DemoSource-nyckel-mappningen som
 * `loadDemoSeed` använder för att gruppera fetchade filer per entitet (#420).
 */

import { describe, it, expect } from "vitest-compat";
import { pathToSourceKey } from "@/lib/client/demo/demo-source-keys";

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
