import { describe, it, expect, beforeEach } from "vitest-compat";
import {
  authorityFor, loadOffice365Config, OFFICE365_CONFIG_KEY, OFFICE365_SCOPES,
} from "@/lib/client/integrations/office365-config";

/**
 * Konfigurationen avgör VILKEN app-registrering byrån autentiserar mot. Blir
 * den fel startar ett OAuth-flöde som faller hos Microsoft med ett fel ingen
 * kan tolka — därför ska ofullständig config fångas här i stället.
 */
beforeEach(() => localStorage.removeItem(OFFICE365_CONFIG_KEY));

describe("loadOffice365Config", () => {
  it("läser byråns egen konfiguration ur localStorage", () => {
    localStorage.setItem(OFFICE365_CONFIG_KEY, JSON.stringify({ clientId: "c", tenantId: "t" }));
    expect(loadOffice365Config()).toEqual({ clientId: "c", tenantId: "t" });
  });

  // null, inte ett halvt objekt: anroparen ska visa "konfigurera" i st.f. att
  // starta ett flöde som garanterat faller.
  it("ger null när ingenting är konfigurerat", () => {
    expect(loadOffice365Config()).toBeNull();
  });

  it("ger null när bara halva konfigurationen finns", () => {
    localStorage.setItem(OFFICE365_CONFIG_KEY, JSON.stringify({ clientId: "c" }));
    expect(loadOffice365Config()).toBeNull();
  });

  // En annan flik, en äldre version eller en handredigering kan ha skrivit
  // vad som helst i localStorage.
  it("ger null på trasig JSON i stället för att krascha", () => {
    localStorage.setItem(OFFICE365_CONFIG_KEY, "{inte json");
    expect(loadOffice365Config()).toBeNull();
  });

  it("ger null när värdena är tomma strängar", () => {
    localStorage.setItem(OFFICE365_CONFIG_KEY, JSON.stringify({ clientId: "", tenantId: "" }));
    expect(loadOffice365Config()).toBeNull();
  });
});

describe("authorityFor", () => {
  it("bygger tenant-scopad authority", () => {
    expect(authorityFor({ clientId: "c", tenantId: "tid" }))
      .toBe("https://login.microsoftonline.com/tid");
  });
});

describe("OFFICE365_SCOPES", () => {
  /**
   * Web-appen SKICKAR (funktion 2). Läsning av inkommande mail går via
   * Outlook-add-in:en med sin egen token. Skulle `Mail.Read` smyga in här
   * växer consent-dialogen utan att någon funktion behöver det — precis den
   * över-fråga ADR 0036 argumenterar emot.
   */
  it("begär bara det web-appen faktiskt använder", () => {
    expect([...OFFICE365_SCOPES]).toEqual(["User.Read", "Mail.Send"]);
  });
});
