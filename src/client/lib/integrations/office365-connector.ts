"use client";

/**
 * Office 365-connector. STUB tills `@azure/msal-browser` adderas som
 * dependency. När det är klart implementerar vi:
 *
 *   1. MSAL `PublicClientApplication.acquireTokenPopup()` för connect
 *   2. `acquireTokenSilent()` i `getAccessToken()` med fallback till
 *      popup om refresh-token förfallit
 *   3. Token cache: MSAL hanterar själv via IndexedDB
 *
 * Konfiguration kommer från `loadOffice365Config()` som läser
 * localStorage (samma mönster som OAuth-config för GitHub).
 */

import type { IntegrationConnector, ConnectionStatus } from "./types";
import { registerConnector } from "./registry";

const SCOPES_DEFAULT = [
  "User.Read",
  "Mail.Read",
  "Files.Read",
  "offline_access",
];

class Office365Connector implements IntegrationConnector {
  readonly id = "office365";
  readonly displayName = "Office 365";
  readonly capabilities = ["mail", "files", "calendar"] as const;

  private status: ConnectionStatus = { kind: "disconnected" };
  private listeners = new Set<(s: ConnectionStatus) => void>();

  async getStatus(): Promise<ConnectionStatus> {
    return this.status;
  }

  async connect(): Promise<void> {
    // TODO: implementera när @azure/msal-browser är installerat
    //   const msal = await import("@azure/msal-browser");
    //   const cfg = loadOffice365Config();
    //   const app = new msal.PublicClientApplication({ ... });
    //   const result = await app.acquireTokenPopup({ scopes: SCOPES_DEFAULT });
    //   this.setStatus({ kind: "connected", account: ..., scopes: SCOPES_DEFAULT });
    void SCOPES_DEFAULT;
    throw new Error("Office 365-connector ej implementerad än — kräver @azure/msal-browser");
  }

  async disconnect(): Promise<void> {
    // TODO: msal.logoutPopup() + clearCache
    this.setStatus({ kind: "disconnected" });
  }

  async getAccessToken(): Promise<string> {
    if (this.status.kind !== "connected") {
      throw new Error("Office 365 är inte ansluten");
    }
    // TODO: msal.acquireTokenSilent
    throw new Error("Office 365-connector ej implementerad än");
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
