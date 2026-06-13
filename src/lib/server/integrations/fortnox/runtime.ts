/**
 * Fortnox-connectorns boot-wiring för server-runtime:n (#82).
 *
 * Bygger ett `PeerJob` ur:
 *   - secrets-valvet (#79): client_id/secret + de roterande OAuth-tokens,
 *   - firma.git: konto-mappningen, deriverad ur byråns org-inställning
 *     `ledgerAccountMap` (#217/#249) som admin redigerar i /settings.
 *
 * Returnerar `null` (→ loopen stannar i sync-läge) när Fortnox inte är
 * konfigurerat: inget valv, inga credentials, eller inte auktoriserad än.
 * Det gör inkopplingen RISKFRI för demo/test/CI — connectorn aktiveras först
 * när en byrå faktiskt anslutit Fortnox.
 */

import { createVaultFromEnv, type SecretsVault } from "../../secrets/vault";
import type { PeerJob } from "../../local-first/peer-loop";
import type { LedgerConnector } from "../ledger/port";
import { FortnoxClient } from "./client";
import { FortnoxLedgerConnector } from "./connector";
import { makeFortnoxInvoiceJob, type FortnoxJobCaller } from "./invoice-job";
import { fortnoxConfigSchema, fortnoxMappingFromLedgerMap, type FortnoxConfig } from "./schema";
import { VaultFortnoxTokenStore } from "./token-store";

export interface BuildFortnoxJobOpts {
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

/**
 * Bygg cykelns `loadConnector`: läs byråns `ledgerAccountMap` via callern
 * (samma org-projektion som /settings skriver), derivera Fortnox-mappningen
 * och linda connectorn runt klienten. `null` när mappningen saknas →
 * completeness-gate (drivern bokför inget).
 */
export function makeLoadConnector(client: FortnoxClient) {
  return async (caller: FortnoxJobCaller): Promise<LedgerConnector | null> => {
    const settings = await caller.organization.getSettings();
    const mapping = fortnoxMappingFromLedgerMap(settings.ledgerAccountMap);
    if (!mapping) return null;
    return new FortnoxLedgerConnector({ client, mapping });
  };
}

/** Bygg FortnoxConfig ur env + valv-credentials (overridebar bas-URL för sandbox). */
function fortnoxConfigFromEnv(
  env: NodeJS.ProcessEnv,
  clientId: string,
  clientSecret: string,
): FortnoxConfig {
  return fortnoxConfigSchema.parse({
    clientId,
    clientSecret,
    // redirectUri/scopes används bara vid authorize; refresh kräver dem ej,
    // men schemat kräver giltiga värden.
    redirectUri: env.AVA_FORTNOX_REDIRECT_URI ?? "http://localhost/fortnox/callback",
    scopes: ["bookkeeping"],
    ...(env.AVA_FORTNOX_AUTH_BASE ? { authBase: env.AVA_FORTNOX_AUTH_BASE } : {}),
    ...(env.AVA_FORTNOX_API_BASE ? { apiBase: env.AVA_FORTNOX_API_BASE } : {}),
    // Opt-in service-konto (#213); default (utelämnad) = user-consent.
    ...(env.AVA_FORTNOX_ACCOUNT_TYPE === "service" ? { accountType: "service" as const } : {}),
  });
}

/** Hämta valvet om det är konfigurerat (env satt), annars null. */
function vaultIfConfigured(env: NodeJS.ProcessEnv): SecretsVault | null {
  if (!env.AVA_SECRETS_KEY || !env.AVA_SECRETS_FILE) return null;
  return createVaultFromEnv(env);
}

export async function buildFortnoxJob(opts: BuildFortnoxJobOpts = {}): Promise<PeerJob | null> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((msg: string) => console.log(`[fortnox] ${msg}`));

  const vault = vaultIfConfigured(env);
  if (!vault) {
    log("valv ej konfigurerat (AVA_SECRETS_KEY/FILE saknas) — connector av");
    return null;
  }

  const clientId = await vault.get("fortnox.client_id");
  const clientSecret = await vault.get("fortnox.client_secret");
  if (!clientId || !clientSecret) {
    log("inga Fortnox-credentials i valvet — connector av");
    return null;
  }

  const store = new VaultFortnoxTokenStore(vault);
  if (!(await store.load())) {
    log("Fortnox ej auktoriserad (inga tokens i valvet) — connector av");
    return null;
  }

  const client = new FortnoxClient(fortnoxConfigFromEnv(env, clientId, clientSecret), store);
  log("connector aktiv — bokför nya fakturor som verifikat");
  // Per cykel: derivera färsk konto-mappning ur byråns ledgerAccountMap (via
  // callern) och bygg connectorn bakom porten. null → completeness-gate.
  return makeFortnoxInvoiceJob({ loadConnector: makeLoadConnector(client), log });
}
