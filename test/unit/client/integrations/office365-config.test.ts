import { describe, it, expect, beforeEach, afterEach, vi } from "vitest-compat";
import {
  authorityFor, loadOffice365Config, OFFICE365_CONFIG_KEY, OFFICE365_SCOPES,
  onceWithin, resolveOffice365Config, serverOffice365Config,
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

const SERVER = { clientId: "srv", tenantId: "stid" };

/** Källornas ordning (#1949): localStorage, byggtids-env, servern. */
describe("resolveOffice365Config", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_AVA_MS_CLIENT_ID;
    delete process.env.NEXT_PUBLIC_AVA_MS_TENANT_ID;
  });

  it("localStorage går före servern, och servern frågas inte", async () => {
    localStorage.setItem(OFFICE365_CONFIG_KEY, JSON.stringify({ clientId: "c", tenantId: "t" }));
    const fromServer = vi.fn(() => Promise.resolve(SERVER));
    expect(await resolveOffice365Config(fromServer)).toEqual({ clientId: "c", tenantId: "t" });
    expect(fromServer).not.toHaveBeenCalled();
  });

  it("byggtids-env går före servern", async () => {
    process.env.NEXT_PUBLIC_AVA_MS_CLIENT_ID = "ec";
    process.env.NEXT_PUBLIC_AVA_MS_TENANT_ID = "et";
    const fromServer = vi.fn(() => Promise.resolve(SERVER));
    expect(await resolveOffice365Config(fromServer)).toEqual({ clientId: "ec", tenantId: "et" });
    expect(fromServer).not.toHaveBeenCalled();
  });

  it("servern används när de två första saknas", async () => {
    expect(await resolveOffice365Config(() => Promise.resolve(SERVER))).toEqual(SERVER);
  });

  it("ingen källa → null", async () => {
    expect(await resolveOffice365Config(() => Promise.resolve(null))).toBeNull();
  });
});

describe("onceWithin", () => {
  it("hämtar ett svar bara en gång, hur många gånger den än anropas", async () => {
    const load = vi.fn(() => Promise.resolve(SERVER));
    const source = onceWithin(load);
    expect(await Promise.all([source(), source()])).toEqual([SERVER, SERVER]);
    expect(await source()).toEqual(SERVER);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("ett null sparas inte: nästa anrop frågar igen", async () => {
    const load = vi.fn(() => Promise.resolve(null));
    const source = onceWithin(load);
    expect(await source()).toBeNull();
    expect(await source()).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("en server som inte svarar ger ingen konfiguration efter tidsgränsen", async () => {
    const source = onceWithin(() => new Promise(() => {}), 5);
    expect(await source()).toBeNull();
  });
});

describe("serverOffice365Config", () => {
  const originalFetch = global.fetch;
  afterEach(() => { global.fetch = originalFetch; });

  it("en server som inte går att nå (demon) räknas som ingen konfiguration", async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await serverOffice365Config()).toBeNull();
  });
});
