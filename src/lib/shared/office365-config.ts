/**
 * Byråns Entra-app (klient-id och tenant), tolkad på ett ställe (#1949).
 *
 * Ramverksfri: webbappens Office 365-connector, serverns `system.office365Config`
 * och Outlook-tillägget (`office-addin/manifest.ts`) läser alla samma schema
 * och samma tolkning av en Entra-issuer.
 */

import { z } from "zod";

/** Klient-id och tenant för en Entra-app. */
export const office365ConfigSchema = z.object({
  /** Application (client) ID från byråns app-registrering. */
  clientId: z.string().min(1),
  /** Tenant-GUID, eller `organizations` för valfri arbetsplats-tenant. */
  tenantId: z.string().min(1),
});

/** Byråns Entra-app: klient-id och tenant. */
export type Office365Config = z.infer<typeof office365ConfigSchema>;

/** Värdena en Entra-app tolkas ur. Saknade värden räknas som osatta. */
export interface EntraAppSource {
  /** Appens klient-id, t.ex. webbinloggningens. */
  clientId?: string | undefined;
  /** OIDC-issuern, `https://login.microsoftonline.com/<tenant>/v2.0` för Entra. */
  issuer?: string | undefined;
  /** Går före `clientId` när den är satt. */
  clientIdOverride?: string | undefined;
  /** Går före tenanten ur issuern när den är satt. */
  tenantIdOverride?: string | undefined;
}

const ENTRA_TENANT = /login\.microsoftonline\.com\/([^/]+)/;

/**
 * Entra-appen ur klient-id och issuer, med valfria override. En issuer som
 * inte är Entra (Keycloak, demon) eller ett saknat värde ger `null`.
 */
export function entraAppConfig(source: EntraAppSource): Office365Config | null {
  const parsed = office365ConfigSchema.safeParse({
    clientId: source.clientIdOverride ?? source.clientId,
    tenantId: source.tenantIdOverride ?? ENTRA_TENANT.exec(source.issuer ?? "")?.[1],
  });
  return parsed.success ? parsed.data : null;
}
