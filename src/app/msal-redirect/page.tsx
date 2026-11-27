"use client";

/**
 * `/msal-redirect/` — MSAL v5:s redirect bridge (#1950).
 *
 * Popupen och den tysta förnyelsen för Office 365 landar här, inte på appens
 * rot där AVA:s uppstart körs. Sidan lämnar bara tillbaka svaret till fönstret
 * som öppnade den. `pathSkipsAuth` släpper sidan, så ingen store byggs och
 * ingen AVA-ram visas.
 */
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { useEffect } from "react";

export default function MsalRedirectPage() {
  useEffect(() => {
    broadcastResponseToMainFrame().catch((e: unknown) => {
      console.error("[msal-redirect] svaret kunde inte lämnas tillbaka:", e);
    });
  }, []);
  return null;
}
