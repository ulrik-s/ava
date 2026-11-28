import { describe, it, expect, beforeEach } from "vitest-compat";
import { OFFICE365_CONFIG_KEY } from "@/lib/client/integrations/office365-config";
import {
  msalRedirectUri, Office365Connector, statusFromResult,
  type MsalLike, type MsalResult, type MsalAccount,
} from "@/lib/client/integrations/office365-connector";
import type { ConnectionStatus } from "@/lib/client/integrations/types";

/**
 * MSAL:s popup går inte att enhetstesta — men allt runt omkring går, och det
 * är där felen bor: statusövergångar som fastnar i "connecting", tyst
 * förnyelse som inte faller tillbaka, en disconnect som lämnar connectorn
 * påstående att den är ansluten.
 */
const ACCOUNT: MsalAccount = { homeAccountId: "h-1", username: "jurist@byra.se", name: "Jurist" };

function result(token = "at-1", account: MsalAccount | null = ACCOUNT): MsalResult {
  return { accessToken: token, account, scopes: ["User.Read", "Mail.Send"] };
}

class FakeMsal implements MsalLike {
  popupCalls = 0;
  silentCalls = 0;
  logoutCalls = 0;
  silentFails = false;
  popupError: Error | null = null;

  async initialize(): Promise<void> {}
  async acquireTokenPopup(): Promise<MsalResult> {
    this.popupCalls++;
    if (this.popupError) throw this.popupError;
    return result("at-popup");
  }
  async acquireTokenSilent(): Promise<MsalResult> {
    this.silentCalls++;
    if (this.silentFails) throw new Error("interaction_required");
    return result("at-silent");
  }
  async logoutPopup(): Promise<void> {
    this.logoutCalls++;
  }
}

/** Ingen server att fråga, om inget annat sägs. */
const noServer = (): Promise<null> => Promise.resolve(null);

function connectorWith(msal: MsalLike, fromServer: () => Promise<{ clientId: string; tenantId: string } | null> = noServer): Office365Connector {
  return new Office365Connector(async () => msal, fromServer);
}

beforeEach(() => {
  localStorage.setItem(OFFICE365_CONFIG_KEY, JSON.stringify({ clientId: "cid", tenantId: "tid" }));
});

describe("statusFromResult", () => {
  it("mappar konto till connected", () => {
    const s = statusFromResult(result());
    expect(s.kind).toBe("connected");
    if (s.kind !== "connected") throw new Error("fel status");
    expect(s.account.email).toBe("jurist@byra.se");
    expect(s.account.displayName).toBe("Jurist");
  });

  // Utan namn ska e-posten duga — ett tomt namn i UI:t är värre än en adress.
  it("faller tillbaka på användarnamnet när name saknas", () => {
    const s = statusFromResult(result("t", { homeAccountId: "h", username: "a@b.se" }));
    if (s.kind !== "connected") throw new Error("fel status");
    expect(s.account.displayName).toBe("a@b.se");
  });

  it("blir error när Microsoft inte gav något konto", () => {
    expect(statusFromResult(result("t", null)).kind).toBe("error");
  });
});

describe("connect", () => {
  it("blir connected efter popup", async () => {
    const c = connectorWith(new FakeMsal());
    await c.connect();
    expect((await c.getStatus()).kind).toBe("connected");
  });

  it("sänder statusövergångarna till prenumeranter", async () => {
    const c = connectorWith(new FakeMsal());
    const seen: ConnectionStatus["kind"][] = [];
    c.subscribe((s) => seen.push(s.kind));
    await c.connect();
    expect(seen).toEqual(["disconnected", "connecting", "connected"]);
  });

  /**
   * Ett kast som lämnar status på "connecting" ser ut som en evig spinner i
   * UI:t. Felet måste hamna i statusen, inte bara i anropets rejection.
   */
  it("lämnar aldrig statusen på connecting när popupen faller", async () => {
    const msal = new FakeMsal();
    msal.popupError = new Error("user_cancelled");
    const c = connectorWith(msal);
    await expect(c.connect()).rejects.toThrow(/user_cancelled/);
    const s = await c.getStatus();
    expect(s.kind).toBe("error");
    if (s.kind === "error") expect(s.message).toContain("user_cancelled");
  });

  // Att starta ett OAuth-flöde utan klient-id ger ett obegripligt Microsoft-fel.
  it("vägrar när konfigurationen saknas, med ett läsbart fel", async () => {
    localStorage.removeItem(OFFICE365_CONFIG_KEY);
    const c = connectorWith(new FakeMsal());
    await expect(c.connect()).rejects.toThrow("Microsoft 365 är inte inställt för den här AVA-installationen.");
  });

  // #1949: i drift kommer byråns app från servern när webbläsaren inte har någon.
  it("tar konfigurationen från servern när localStorage och env saknar den", async () => {
    localStorage.removeItem(OFFICE365_CONFIG_KEY);
    const seen: { clientId: string; authority: string }[] = [];
    const c = new Office365Connector((opts) => { seen.push(opts); return Promise.resolve(new FakeMsal()); },
      () => Promise.resolve({ clientId: "srv", tenantId: "stid" }));
    await c.connect();
    expect(seen).toEqual([{ clientId: "srv", authority: "https://login.microsoftonline.com/stid" }]);
  });
});

describe("getAccessToken", () => {
  it("kastar när connectorn inte är ansluten", async () => {
    await expect(connectorWith(new FakeMsal()).getAccessToken()).rejects.toThrow(/inte ansluten/);
  });

  it("hämtar tyst när det går", async () => {
    const msal = new FakeMsal();
    const c = connectorWith(msal);
    await c.connect();
    expect(await c.getAccessToken()).toBe("at-silent");
    expect(msal.popupCalls).toBe(1); // bara connect-popupen
  });

  /**
   * `interaction_required` är inte ett fel — det är Microsofts sätt att säga
   * "fråga användaren". Utan fallbacken hade en utgången session sett ut som
   * ett trasigt AVA.
   */
  it("faller tillbaka på popup när tyst förnyelse nekas", async () => {
    const msal = new FakeMsal();
    const c = connectorWith(msal);
    await c.connect();
    msal.silentFails = true;
    expect(await c.getAccessToken()).toBe("at-popup");
    expect(msal.popupCalls).toBe(2);
  });
});

describe("disconnect", () => {
  it("blir disconnected och loggar ut", async () => {
    const msal = new FakeMsal();
    const c = connectorWith(msal);
    await c.connect();
    await c.disconnect();
    expect((await c.getStatus()).kind).toBe("disconnected");
    expect(msal.logoutCalls).toBe(1);
  });

  /**
   * Popup-blockerare finns. Faller utloggningen ska connectorn ändå ha slutat
   * påstå att den är ansluten — annars visar UI:t ett konto användaren tror
   * att hen loggat ut från.
   */
  it("nollställer status även när utloggningen faller", async () => {
    const msal = new FakeMsal();
    msal.logoutPopup = async () => { throw new Error("popup blocked"); };
    const c = connectorWith(msal);
    await c.connect();
    await expect(c.disconnect()).rejects.toThrow(/popup blocked/);
    expect((await c.getStatus()).kind).toBe("disconnected");
  });

  it("token kan inte hämtas efter disconnect", async () => {
    const c = connectorWith(new FakeMsal());
    await c.connect();
    await c.disconnect().catch(() => {});
    await expect(c.getAccessToken()).rejects.toThrow(/inte ansluten/);
  });
});

describe("msalRedirectUri (#1950)", () => {
  it("pekar på bridge-sidan, med och utan basePath", () => {
    expect(msalRedirectUri("https://ava.byra.se", "")).toBe("https://ava.byra.se/msal-redirect/");
    expect(msalRedirectUri("https://u.github.io", "/ava")).toBe("https://u.github.io/ava/msal-redirect/");
  });
});

describe("preload (#1950)", () => {
  /** Fabrik som räknar sina anrop, för att se att connect() inte laddar MSAL igen. */
  function counting(msal: MsalLike) {
    const calls: { clientId: string; authority: string }[] = [];
    const factory = (opts: { clientId: string; authority: string }) => { calls.push(opts); return Promise.resolve(msal); };
    return { calls, factory };
  }

  it("efter preload laddar connect() inte MSAL igen", async () => {
    const msal = new FakeMsal();
    const { calls, factory } = counting(msal);
    const c = new Office365Connector(factory, noServer);
    await c.preload();
    await c.connect();
    expect(calls).toEqual([{ clientId: "cid", authority: "https://login.microsoftonline.com/tid" }]);
    expect((await c.getStatus()).kind).toBe("connected");
  });

  it("efter preload anropas popupen synkront i connect(), utan att vänta på något", async () => {
    let configReads = 0;
    const msal = new FakeMsal();
    const c = new Office365Connector(counting(msal).factory, () => { configReads++; return Promise.resolve(null); });
    await c.preload();
    const reads = configReads;
    const pending = c.connect();
    expect(msal.popupCalls).toBe(1);
    expect(configReads).toBe(reads);
    await pending;
  });

  it("preload ändrar inte statusen", async () => {
    const c = connectorWith(new FakeMsal());
    await c.preload();
    expect(await c.getStatus()).toEqual({ kind: "disconnected" });
  });

  it("utan konfiguration ger preload samma fel som connect", async () => {
    localStorage.removeItem(OFFICE365_CONFIG_KEY);
    const c = connectorWith(new FakeMsal());
    await expect(c.preload()).rejects.toThrow("Microsoft 365 är inte inställt för den här AVA-installationen.");
    await expect(c.connect()).rejects.toThrow("Microsoft 365 är inte inställt för den här AVA-installationen.");
  });

  it("en popup som faller efter preload hamnar i statusen", async () => {
    const msal = new FakeMsal();
    msal.popupError = new Error("popup_window_error");
    const c = connectorWith(msal);
    await c.preload();
    await expect(c.connect()).rejects.toThrow(/popup_window_error/);
    expect((await c.getStatus()).kind).toBe("error");
  });

  it("utan preload väntar connect() på fabriken innan popupen, som förut", async () => {
    const msal = new FakeMsal();
    const c = connectorWith(msal);
    const pending = c.connect();
    expect(msal.popupCalls).toBe(0);
    await pending;
    expect(msal.popupCalls).toBe(1);
  });
});

/** Testsömmen (#1952): en fast Graph-token ger token utan MSAL. */
describe("fast token (#1952)", () => {
  /** Fabrik som räknar sina anrop: med fast token ska den aldrig anropas. */
  function never() {
    const calls: unknown[] = [];
    const factory = (opts: unknown) => { calls.push(opts); return Promise.resolve(new FakeMsal()); };
    return { calls, factory };
  }

  it("connect blir ansluten och token är den fasta, utan att MSAL laddas", async () => {
    const { calls, factory } = never();
    const c = new Office365Connector(factory, noServer, () => "fast");
    await c.preload();
    await c.connect();
    expect((await c.getStatus()).kind).toBe("connected");
    expect(await c.getAccessToken()).toBe("fast");
    expect(calls).toEqual([]);
  });

  it("läser fältet ur localStorage som standard", async () => {
    localStorage.setItem(OFFICE365_CONFIG_KEY, JSON.stringify({ staticGraphToken: "ur-lagringen" }));
    const { calls, factory } = never();
    const c = new Office365Connector(factory, noServer);
    await c.connect();
    expect(await c.getAccessToken()).toBe("ur-lagringen");
    expect(calls).toEqual([]);
  });

  it("utan fältet är det MSAL som förut", async () => {
    const msal = new FakeMsal();
    const c = new Office365Connector(() => Promise.resolve(msal), noServer, () => null);
    await c.connect();
    expect(await c.getAccessToken()).toBe("at-silent");
    expect(msal.popupCalls).toBe(1);
  });
});
