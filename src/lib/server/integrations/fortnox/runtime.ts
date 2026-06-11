/**
 * Fortnox-connectorns boot-wiring för server-runtime:n (#82).
 *
 * Bygger ett `PeerJob` ur:
 *   - secrets-valvet (#79): client_id/secret + de roterande OAuth-tokens,
 *   - firma.git: konto-mappningen (`settings/fortnox-account-map.json`, #217).
 *
 * Returnerar `null` (→ loopen stannar i sync-läge) när Fortnox inte är
 * konfigurerat: inget valv, inga credentials, eller inte auktoriserad än.
 * Det gör inkopplingen RISKFRI för demo/test/CI — connectorn aktiveras först
 * när en byrå faktiskt anslutit Fortnox.
 */

import { join } from "node:path";

import { createVaultFromEnv, type SecretsVault } from "../../secrets/vault";
import type { PeerJob } from "../../local-first/peer-loop";
import { FortnoxClient } from "./client";
import { makeFortnoxInvoiceJob } from "./invoice-job";
import {
  fortnoxConfigSchema,
  fortnoxKontoMappningSchema,
  type FortnoxConfig,
  type FortnoxKontoMappning,
} from "./schema";
import { VaultFortnoxTokenStore } from "./token-store";

/** Sökväg (relativt working-copy:n) till byråns konto-mappning. */
export const KONTO_MAPPNING_PATH = "settings/fortnox-account-map.json";

export interface BuildFortnoxJobOpts {
  /** Server-runtime:ns working-copy (firma.git-klonen). */
  workDir: string;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

/** Läs + strikt-parsa konto-mappningen ur firma.git. null om filen saknas. */
export async function loadKontoMappning(workDir: string): Promise<FortnoxKontoMappning | null> {
  const { readFile } = await import("node:fs/promises");
  let raw: string;
  try {
    raw = await readFile(join(workDir, KONTO_MAPPNING_PATH), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return fortnoxKontoMappningSchema.parse(JSON.parse(raw));
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
  });
}

/** Hämta valvet om det är konfigurerat (env satt), annars null. */
function vaultIfConfigured(env: NodeJS.ProcessEnv): SecretsVault | null {
  if (!env.AVA_SECRETS_KEY || !env.AVA_SECRETS_FILE) return null;
  return createVaultFromEnv(env);
}

export async function buildFortnoxJob(opts: BuildFortnoxJobOpts): Promise<PeerJob | null> {
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
  return makeFortnoxInvoiceJob({
    client,
    loadMapping: () => loadKontoMappning(opts.workDir),
    log,
  });
}
