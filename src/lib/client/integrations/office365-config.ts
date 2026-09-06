"use client";

/**
 * Konfiguration för Office 365-connectorn (#1076).
 *
 * Två källor, i den ordningen:
 *
 *  1. **localStorage** — byrån pekar ut sin EGEN app-registrering. Det är
 *     normalfallet i self-hosted drift: varje byrå consentar i sin egen tenant,
 *     ingen delad app-identitet över byråer.
 *  2. **Build-time env** — bekvämlighet för dev och demo.
 *
 * Ingen tredje: ett hårdkodat klient-id hade betytt att alla byråer delade
 * app-registrering, och därmed att en byrås admin-consent gällde en app någon
 * annan också använder.
 */

import { z } from "zod";

import { loadFromStorage } from "../load-from-storage";

export const OFFICE365_CONFIG_KEY = "ava.office365.config";

/**
 * Scopes web-appen begär. Delmängd av ADR 0036:s lista — web-appen SKICKAR
 * (funktion 2). Inkommande mail går via Outlook-add-in:en, som har sin egen
 * token via `getCallbackTokenAsync` och inte behöver MSAL.
 *
 * `offline_access` ingår inte: MSAL sköter förnyelsen själv och begär den
 * implicit. Att lista den skulle bara göra consent-dialogen längre.
 */
export const OFFICE365_SCOPES = [
  "User.Read",
  "Mail.Send",
] as const;

export const office365ConfigSchema = z.object({
  /** Application (client) ID från byråns app-registrering. */
  clientId: z.string().min(1),
  /** Tenant-GUID, eller `organizations` för valfri arbetsplats-tenant. */
  tenantId: z.string().min(1),
});
export type Office365Config = z.infer<typeof office365ConfigSchema>;

/** Byggtids-defaults. Tomma strängar = inte konfigurerad. */
function fromEnv(): Office365Config {
  return {
    clientId: process.env.NEXT_PUBLIC_AVA_MS_CLIENT_ID ?? "",
    tenantId: process.env.NEXT_PUBLIC_AVA_MS_TENANT_ID ?? "",
  };
}

/**
 * Läs konfigurationen. Returnerar `null` när den inte är komplett — anroparen
 * ska visa "konfigurera Office 365" i st.f. att starta ett OAuth-flöde som
 * garanterat faller.
 */
export function loadOffice365Config(): Office365Config | null {
  const env = fromEnv();
  const stored = loadFromStorage(OFFICE365_CONFIG_KEY, office365ConfigSchema.partial(), {});
  const merged = { clientId: stored.clientId ?? env.clientId, tenantId: stored.tenantId ?? env.tenantId };
  const parsed = office365ConfigSchema.safeParse(merged);
  return parsed.success ? parsed.data : null;
}

/** Authority-URL:en MSAL ska peka på. */
export function authorityFor(config: Office365Config): string {
  return `https://login.microsoftonline.com/${config.tenantId}`;
}
