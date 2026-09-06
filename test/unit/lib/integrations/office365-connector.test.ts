/**
 * Registry-sidan av Office365-connectorn: att den registrerar sig vid import,
 * och att pub/sub-kontraktet UI:n läser status ur håller.
 *
 * Själva MSAL-logiken (connect, tyst förnyelse, disconnect) testas mot en
 * injicerad söm i `test/unit/client/integrations/office365-connector.test.ts`
 * — den kan inte nås genom registry-singletonen, som med flit bär den riktiga
 * MSAL-fabriken.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import "@/lib/client/integrations/office365-connector"; // side-effect: registrerar
import { getConnector } from "@/lib/client/integrations/registry";
import type { IntegrationConnector } from "@/lib/client/integrations/types";

function office365(): IntegrationConnector {
  const c = getConnector("office365");
  if (!c) throw new Error("office365-connector ej registrerad");
  return c;
}

describe("Office365Connector (registry)", () => {
  beforeEach(async () => {
    // Återställ till disconnected mellan tester (delad singleton i registry).
    await office365().disconnect();
  });

  /**
   * `capabilities` renderas i /settings. Den ska beskriva vad connectorn
   * FAKTISKT kan — stubben listade "files" och "calendar" som ingen kod bakom
   * den någonsin gjort, och scopen (`User.Read`, `Mail.Send`) räcker inte till
   * dem. En capability-lista man inte kan lita på är sämre än en kort.
   */
  it("metadata: id, displayName, och bara de capabilities som finns", () => {
    const c = office365();
    expect(c.id).toBe("office365");
    expect(c.displayName).toBe("Office 365");
    expect([...c.capabilities]).toEqual(["mail"]);
  });

  it("startar i disconnected", async () => {
    expect(await office365().getStatus()).toEqual({ kind: "disconnected" });
  });

  it("getAccessToken() kastar när disconnected", async () => {
    await expect(office365().getAccessToken()).rejects.toThrow(/inte ansluten/i);
  });

  it("subscribe anropar lyssnaren direkt med nuvarande status + returnerar avprenumerant", async () => {
    const c = office365();
    const seen: string[] = [];
    const unsub = c.subscribe((s) => seen.push(s.kind));
    expect(seen).toEqual(["disconnected"]); // omedelbart anrop
    await c.disconnect();
    expect(seen).toEqual(["disconnected", "disconnected"]); // notifierad igen
    unsub();
    await c.disconnect();
    expect(seen).toHaveLength(2); // ej anropad efter avprenumeration
  });

  it("en lyssnare som kastar fångas — övriga lyssnare notifieras ändå", async () => {
    const c = office365();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    c.subscribe(() => { n += 1; if (n > 1) throw new Error("boom"); }); // kastar vid disconnect-notis
    const good: string[] = [];
    c.subscribe((s) => good.push(s.kind));
    await expect(c.disconnect()).resolves.toBeUndefined(); // kastar INTE
    expect(good).toContain("disconnected");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
