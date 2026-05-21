"use client";

/**
 * Connector-typer för externa integrationer (Office 365, Google
 * Workspace, Dropbox, …). Varje connector implementerar samma
 * interface; UI:n (`/profile` → Anslutna tjänster) renderas generiskt
 * från registry:t.
 *
 * Designval:
 *   - Tokens lagras *per device*, aldrig i git (säkerhet)
 *   - Connector:n äger sin egen storage (MSAL.js använder IndexedDB,
 *     Google använder annan store, etc.)
 *   - Access-token refreshas automatiskt — consumern frågar bara
 *     `getAccessToken()` när den behöver
 */

export type ConnectionStatus =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "connected"; account: { id: string; displayName: string; email: string }; scopes: string[] }
  | { kind: "expired"; account: { id: string; displayName: string; email: string }; reason: string }
  | { kind: "error"; message: string };

export interface IntegrationConnector {
  /** Unikt id (slug), matchar nyckeln i registry:n. */
  readonly id: string;
  /** Visningsnamn ("Office 365"). */
  readonly displayName: string;
  /** Vilka funktioner connector:n erbjuder ("mail", "files", "calendar", …). */
  readonly capabilities: readonly string[];
  /** Hämta nuvarande status. Skickar inte nätverk om cache räcker. */
  getStatus(): Promise<ConnectionStatus>;
  /** Starta OAuth-flow. Resolvar när användaren godkänt. */
  connect(): Promise<void>;
  /** Återkalla token + rensa lokal cache. */
  disconnect(): Promise<void>;
  /**
   * Returnerar nuvarande access-token. Refreshar automatiskt om
   * utgånget. Kastar om disconnected.
   */
  getAccessToken(): Promise<string>;
  /** Subscribera på status-byten. Returnerar unsub. */
  subscribe(listener: (status: ConnectionStatus) => void): () => void;
}
