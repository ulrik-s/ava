"use client";

/**
 * Konfiguration för Office 365-connectorn (#1076).
 *
 * Tre källor, i den ordningen:
 *
 *  1. **localStorage** — byrån pekar ut en egen app-registrering för hand.
 *  2. **Build-time env** — bekvämlighet för dev och demo.
 *  3. **Servern** (`system.office365Config`, #1949) — webbinloggningens app ur
 *     installationens egen miljö. Det är normalfallet i drift.
 *
 * Inget av det är hårdkodat: serverns värden kommer ur installationens miljö,
 * alltså byråns egen app i byråns egen tenant, samma app som webbinloggningen
 * redan använder. Ett hårdkodat klient-id hade betytt att alla byråer delade
 * app-registrering, och därmed att en byrås admin-consent gällde en app någon
 * annan också använder.
 */

import { type Office365Config, office365ConfigSchema } from "@/lib/shared/office365-config";
import { withinOrNull } from "../backend/local-data/browser-sign-out";
import { loadServerOffice365Config } from "../backend/server-trpc-client";
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

/** Hur länge connectorn väntar på serverns konfiguration innan den går vidare utan. */
export const SERVER_CONFIG_TIMEOUT_MS = 3_000;

/** En källa som hämtar konfigurationen asynkront, t.ex. från servern. */
export type Office365ConfigSource = () => Promise<Office365Config | null>;

/**
 * `load` med tidsgräns, och med svaret sparat: ett svar hämtas bara en gång.
 * Ett `null` (ingen server, tidsgränsen gick ut) sparas inte, så nästa anrop
 * frågar igen.
 */
export function onceWithin(load: Office365ConfigSource, ms: number = SERVER_CONFIG_TIMEOUT_MS): Office365ConfigSource {
  let pending: Promise<Office365Config | null> | undefined;
  return async () => {
    pending ??= withinOrNull(load(), ms);
    const config = await pending;
    if (!config) pending = undefined;
    return config;
  };
}

/** Serverns konfiguration (#1949), med tidsgräns och hämtad en gång. */
export const serverOffice365Config: Office365ConfigSource = onceWithin(loadServerOffice365Config);

/** Konfigurationen ur localStorage och byggtids-env, annars ur `fromServer`. */
export async function resolveOffice365Config(fromServer: Office365ConfigSource): Promise<Office365Config | null> {
  return loadOffice365Config() ?? fromServer();
}

/** Authority-URL:en MSAL ska peka på. */
export function authorityFor(config: Office365Config): string {
  return `https://login.microsoftonline.com/${config.tenantId}`;
}
