/**
 * Microsoft Graph-connector — zod-scheman (#1072).
 *
 * Samma form som Fortnox-motsvarigheten: ren config/data, inga hemligheter
 * hårdkodade, strikt parsning av allt som kommer utifrån
 * ([[feedback-zod-strict-parsing]]).
 */

import { z } from "zod";

/** Entra-ID:s inloggningsvärd. Overridebar för test. */
export const MS_AUTH_BASE = "https://login.microsoftonline.com";
export const MS_GRAPH_BASE = "https://graph.microsoft.com";

/**
 * Minsta scope-uppsättningen för epicen (#1069): läsa och skicka mail som den
 * inloggade juristen, plus refresh-token.
 *
 * `offline_access` är inte valfri kosmetik — utan den skickar Entra ingen
 * refresh-token alls, och hela obevakade CI-kedjan faller.
 */
export const MS_DEFAULT_SCOPES = [
  "offline_access",
  `${MS_GRAPH_BASE}/Mail.Read`,
  `${MS_GRAPH_BASE}/Mail.Send`,
  `${MS_GRAPH_BASE}/User.Read`,
] as const;

export const msGraphConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  /**
   * Tenant-id (GUID) eller `common`/`organizations`. GUID för en enskild byrå:
   * `common` släpper in vem som helst med ett Microsoft-konto.
   */
  tenantId: z.string().min(1),
  /** Måste matcha en registrerad redirect-URI i app-registreringen. */
  redirectUri: z.string().url(),
  scopes: z.array(z.string().min(1)).min(1),
  authBase: z.string().url().default(MS_AUTH_BASE),
});
export type MsGraphConfig = z.infer<typeof msGraphConfigSchema>;

/**
 * Råsvar från `POST /{tenant}/oauth2/v2.0/token`.
 *
 * `refresh_token` är VALFRI i schemat men obligatorisk i praktiken: Entra
 * utelämnar den när `offline_access` inte begärts. Det felet ska synas som ett
 * begripligt meddelande i `ms-connect`, inte som en zod-stacktrace.
 */
export const msTokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  token_type: z.string(),
  expires_in: z.number().int().positive(),
  scope: z.string().optional(),
});
export type MsTokenResponse = z.infer<typeof msTokenResponseSchema>;

/**
 * Persisterade tokens. Entra utfärdar en NY refresh-token vid varje refresh och
 * den gamla ska kastas — samma write-back-krav som Fortnox (#1073).
 * `accessTokenExpiresAt` = epoch ms.
 */
export const msStoredTokensSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessTokenExpiresAt: z.number().int(),
});
export type MsStoredTokens = z.infer<typeof msStoredTokensSchema>;
