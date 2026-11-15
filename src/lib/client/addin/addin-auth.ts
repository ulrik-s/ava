/**
 * Inloggning i Outlook-tillägget: Nested App Authentication (NAA) via MSAL.
 * Outlook lämnar ut token tyst (enkel inloggning), så juristen loggar aldrig
 * in i tillägget.
 *
 * Microsoft stängde av de gamla Exchange-token (getCallbackTokenAsync) för
 * alla tenants i oktober 2025, och Outlook REST v2.0 är avvecklat. NAA +
 * Microsoft Graph är den väg som gäller. Se docs/outlook-addin.md.
 *
 * Två token från samma Entra-app (AVA:s webbapp):
 *   - AVA:s API: `api://<klient-id>/access_as_user`, som oauth2-proxy redan
 *     validerar för AVA Helper (Bearer-vägen till /api).
 *   - Graph: `Mail.Read`, för att hämta det öppna mejlet som .eml.
 */

import {
  createNestablePublicClientApplication,
  type Configuration,
  type IPublicClientApplication,
} from "@azure/msal-browser";

/** Tilläggets konfiguration, satt per installation av `config.js` (office-addin/manifest.ts). */
export interface AddinConfig {
  /** AVA-appens klient-id i byråns Entra. */
  clientId: string;
  /** Byråns tenant-id. */
  tenantId: string;
  /** Graph-bas; bara E2E-servern sätter en egen. */
  graphBaseUrl?: string;
  /** Fasta token i stället för NAA — för E2E och lokal utveckling utan Outlook. */
  staticTokens?: { ava: string; graph: string; name: string };
}

export interface AddinUser { name: string; username: string }

/** Var token kommer ifrån, sett från task-panen. */
export interface AddinTokens {
  ava(): Promise<string>;
  graph(): Promise<string>;
  /** Den inloggade, när en token väl har hämtats. */
  user(): AddinUser | null;
}

export const GRAPH_MAIL_SCOPE = "Mail.Read";
export const avaScope = (clientId: string): string => `api://${clientId}/access_as_user`;

type PcaFactory = (config: Configuration) => Promise<IPublicClientApplication>;

/** Token via NAA. Tyst i första hand; kräver Entra en interaktion öppnas Outlooks egen dialog. */
async function naaTokens(config: AddinConfig, create: PcaFactory): Promise<AddinTokens> {
  const pca = await create({
    auth: { clientId: config.clientId, authority: `https://login.microsoftonline.com/${config.tenantId}` },
  });
  const get = async (scopes: string[]): Promise<string> => {
    const account = pca.getActiveAccount() ?? pca.getAllAccounts()[0];
    let result;
    try {
      result = await pca.acquireTokenSilent({ scopes, ...(account ? { account } : {}) });
    } catch {
      result = await pca.acquireTokenPopup({ scopes });
    }
    pca.setActiveAccount(result.account);
    return result.accessToken;
  };
  return {
    ava: () => get([avaScope(config.clientId)]),
    graph: () => get([GRAPH_MAIL_SCOPE]),
    user: () => {
      const a = pca.getActiveAccount();
      return a ? { name: a.name ?? a.username, username: a.username } : null;
    },
  };
}

/** Tokenkällan för en konfiguration. */
export async function createAddinTokens(config: AddinConfig, create: PcaFactory = createNestablePublicClientApplication): Promise<AddinTokens> {
  const fixed = config.staticTokens;
  if (fixed) {
    const user = { name: fixed.name, username: fixed.name };
    return { ava: () => Promise.resolve(fixed.ava), graph: () => Promise.resolve(fixed.graph), user: () => user };
  }
  return naaTokens(config, create);
}
