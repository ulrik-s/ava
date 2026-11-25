/**
 * Webbappens Entra-app (#1949): samma app som webbinloggningen, ur serverns
 * miljö. `AVA_IDENTITY_AUDIENCE` är oauth2-proxys klient-id (kommaseparerat
 * för flera); det första värdet är webbinloggningens app. `AVA_ADDIN_*` gäller
 * bara Outlook-tillägget och läses inte här.
 */

import { type Office365Config, entraAppConfig } from "@/lib/shared/office365-config";
import { parseAudience } from "../../http/bearer-claims";

/** Det första värdet i en audience-lista, eller värdet självt. */
function firstAudience(raw: string | undefined): string | undefined {
  const audience = parseAudience(raw);
  return Array.isArray(audience) ? audience[0] : audience;
}

/** Webbappens Entra-app, eller `null` när issuern inte är Entra eller något saknas. */
export function webAppOffice365Config(env: Record<string, string | undefined> = process.env): Office365Config | null {
  return entraAppConfig({
    clientId: firstAudience(env.AVA_IDENTITY_AUDIENCE),
    issuer: env.AVA_IDENTITY_ISSUER?.trim(),
  });
}
