"use client";

/**
 * Office 365-connector (#1076) — MSAL i web-appen.
 *
 * Låser upp **funktion 2** i ADR 0013: maila ut ett ärendedokument från
 * web-appen. Funktion 1 (spara inkommande mail) går via Outlook-add-in:en och
 * `getCallbackTokenAsync`, alltså utan MSAL.
 *
 * ## Två designval värda att förstå
 *
 * **MSAL laddas dynamiskt.** `@azure/msal-browser` är ett stort paket, och
 * ingen som aldrig ansluter Office 365 ska betala för det i sin bundle. Därför
 * `await import(...)` först i `connect()` — inte en toppnivå-import.
 *
 * **MSAL injiceras.** Popup-baserad auth går inte att enhetstesta, men allt
 * runt omkring går: statusövergångar, tyst förnyelse med popup-fallback,
 * felhantering. Sömmen (`MsalLike`) gör den delen testbar utan browser, och
 * det är den delen som faktiskt kan gå sönder.
 */

import { loadOffice365Config, authorityFor, OFFICE365_SCOPES } from "./office365-config";
import { registerConnector } from "./registry";
import type { IntegrationConnector, ConnectionStatus } from "./types";

/** Den delmängd av MSAL:s `PublicClientApplication` connectorn använder. */
export interface MsalLike {
  initialize(): Promise<void>;
  acquireTokenPopup(req: { scopes: string[] }): Promise<MsalResult>;
  acquireTokenSilent(req: { scopes: string[]; account: MsalAccount }): Promise<MsalResult>;
  logoutPopup(req?: { account?: MsalAccount }): Promise<void>;
}

export interface MsalAccount {
  readonly homeAccountId: string;
  readonly username: string;
  readonly name?: string;
}

export interface MsalResult {
  readonly accessToken: string;
  readonly account: MsalAccount | null;
  readonly scopes?: readonly string[];
}

/** Skapar MSAL-instansen. Injicerbar; default laddar paketet dynamiskt. */
export type MsalFactory = (opts: { clientId: string; authority: string }) => Promise<MsalLike>;

/**
 * Adaptern mot riktiga MSAL. Explicit metod för metod, inte en cast:
 * `PublicClientApplication` är nästan strukturellt kompatibel med `MsalLike`,
 * och "nästan" är precis vad en dubbel-cast hade dolt (ADR 0026).
 *
 * Skillnaden som gör adaptern nödvändig: MSAL:s `SilentRequest` vill ha en
 * komplett `AccountInfo` (med `environment`, `tenantId`, `localAccountId` …),
 * medan connectorn bara bär de tre fält den faktiskt läser. Det riktiga kontot
 * slås därför upp i MSAL:s egen cache via `getAllAccounts()`.
 */
const defaultFactory: MsalFactory = async ({ clientId, authority }) => {
  const msal = await import("@azure/msal-browser");
  const app = new msal.PublicClientApplication({
    auth: { clientId, authority, redirectUri: window.location.origin },
    // MSAL cachar i sessionStorage som default. Tokens ska överleva en
    // omladdning men INTE ligga kvar för nästa person vid datorn — och en
    // advokatbyrås delade arbetsstation är inte ett påhittat fall.
    cache: { cacheLocation: "sessionStorage" },
  });
  await app.initialize();

  const resolve = (account: MsalAccount) => {
    const real = app.getAllAccounts().find((a) => a.homeAccountId === account.homeAccountId);
    if (!real) throw new Error("Kontot finns inte längre i MSAL:s cache — anslut Office 365 på nytt.");
    return real;
  };

  return {
    initialize: () => app.initialize(),
    acquireTokenPopup: (req) => app.acquireTokenPopup(req),
    acquireTokenSilent: (req) => app.acquireTokenSilent({ scopes: req.scopes, account: resolve(req.account) }),
    logoutPopup: (req) => app.logoutPopup(req?.account ? { account: resolve(req.account) } : {}),
  };
};

/** Översätt ett MSAL-resultat till connector-status. */
export function statusFromResult(result: MsalResult): ConnectionStatus {
  const acct = result.account;
  if (!acct) return { kind: "error", message: "Microsoft returnerade ingen kontoinformation." };
  return {
    kind: "connected",
    account: { id: acct.homeAccountId, displayName: acct.name ?? acct.username, email: acct.username },
    scopes: [...(result.scopes ?? OFFICE365_SCOPES)],
  };
}

export class Office365Connector implements IntegrationConnector {
  readonly id = "office365";
  readonly displayName = "Office 365";
  readonly capabilities = ["mail"] as const;

  private status: ConnectionStatus = { kind: "disconnected" };
  private readonly listeners = new Set<(s: ConnectionStatus) => void>();
  private msal: MsalLike | null = null;
  private account: MsalAccount | null = null;

  constructor(private readonly factory: MsalFactory = defaultFactory) {}

  async getStatus(): Promise<ConnectionStatus> {
    return this.status;
  }

  async connect(): Promise<void> {
    const config = loadOffice365Config();
    if (!config) {
      const message = "Office 365 är inte konfigurerad — ange klient-id och tenant under Inställningar.";
      this.setStatus({ kind: "error", message });
      throw new Error(message);
    }
    this.setStatus({ kind: "connecting" });
    try {
      this.msal = await this.factory({ clientId: config.clientId, authority: authorityFor(config) });
      const result = await this.msal.acquireTokenPopup({ scopes: [...OFFICE365_SCOPES] });
      this.account = result.account;
      this.setStatus(statusFromResult(result));
    } catch (e: unknown) {
      // Statusen måste bära felet: UI:t renderas ur den, och ett kast som
      // lämnar status på "connecting" ser ut som en evig spinner.
      this.setStatus({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }

  async disconnect(): Promise<void> {
    // Rensa lokalt FÖRST: går logoutPopup fel (blockerad popup, stängd flik)
    // ska connectorn ändå sluta påstå att den är ansluten.
    const { msal, account } = this;
    this.msal = null;
    this.account = null;
    this.setStatus({ kind: "disconnected" });
    if (msal) await msal.logoutPopup(account ? { account } : {});
  }

  /**
   * Access-token, tyst om möjligt.
   *
   * `acquireTokenSilent` faller när MSAL:s egen refresh-token gått ut eller
   * villkorsstyrd åtkomst kräver interaktion. Det är INTE ett fel — det är
   * Microsofts sätt att säga "fråga användaren". Popup-fallbacken är därför
   * en del av det normala flödet, inte en felhantering.
   */
  async getAccessToken(): Promise<string> {
    if (!this.msal || !this.account || this.status.kind !== "connected") {
      throw new Error("Office 365 är inte ansluten");
    }
    const scopes = [...OFFICE365_SCOPES];
    try {
      return (await this.msal.acquireTokenSilent({ scopes, account: this.account })).accessToken;
    } catch {
      const result = await this.msal.acquireTokenPopup({ scopes });
      this.account = result.account;
      this.setStatus(statusFromResult(result));
      return result.accessToken;
    }
  }

  subscribe(listener: (s: ConnectionStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => { this.listeners.delete(listener); };
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    for (const l of this.listeners) {
      try { l(s); } catch (e) { console.error("[office365] listener kastade:", e); }
    }
  }
}

registerConnector(new Office365Connector());
