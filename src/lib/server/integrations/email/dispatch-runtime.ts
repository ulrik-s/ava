/**
 * Boot-wiring av fakturautskicks-workern (#180) för server-runtime:n.
 *
 * Bygger ett `PeerJob` ur SMTP-creds i secrets-valvet (#79). Returnerar `null`
 * när SMTP inte är konfigurerat → riskfritt för demo/test/CI (workern aktiveras
 * först när byrån lagt in SMTP-uppgifter i valvet). Capability-gating per ADR
 * 0011-anda: ingen sändare → ingen utskicks-peer.
 */

import type { PeerJob } from "../../local-first/peer-loop";
import { createVaultFromEnv, type SecretsVault } from "../../secrets/vault";
import { makeDispatchJob } from "./dispatch-job";
import type { EmailSender } from "./email-sender";
import { createSmtpSender, type SmtpConfig } from "./smtp-sender";

export interface BuildDispatchJobOpts {
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
}

/** Valv-nycklar för SMTP-uppgifterna. */
export const SMTP_VAULT_KEYS = {
  host: "smtp.host",
  port: "smtp.port",
  user: "smtp.user",
  pass: "smtp.pass",
  from: "smtp.from",
} as const;

function vaultIfConfigured(env: NodeJS.ProcessEnv): SecretsVault | null {
  if (!env.AVA_SECRETS_KEY || !env.AVA_SECRETS_FILE) return null;
  return createVaultFromEnv(env);
}

/** Läs SMTP-config ur valvet; null om något obligatoriskt fält saknas. */
async function smtpConfigFromVault(vault: SecretsVault): Promise<SmtpConfig | null> {
  const [host, port, user, pass, from] = await Promise.all([
    vault.get(SMTP_VAULT_KEYS.host),
    vault.get(SMTP_VAULT_KEYS.port),
    vault.get(SMTP_VAULT_KEYS.user),
    vault.get(SMTP_VAULT_KEYS.pass),
    vault.get(SMTP_VAULT_KEYS.from),
  ]);
  if (!host || !user || !pass || !from) return null;
  return { host, port: Number(port) || 587, user, pass, from };
}

export async function buildDispatchJob(opts: BuildDispatchJobOpts = {}): Promise<PeerJob | null> {
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((msg: string) => console.log(`[dispatch] ${msg}`));

  const vault = vaultIfConfigured(env);
  if (!vault) {
    log("valv ej konfigurerat (AVA_SECRETS_KEY/FILE saknas) — utskick av");
    return null;
  }
  const smtp = await smtpConfigFromVault(vault);
  if (!smtp) {
    log("inga SMTP-uppgifter i valvet (smtp.host/user/pass/from) — utskick av");
    return null;
  }

  log(`utskick aktivt — SMTP ${smtp.host}:${smtp.port}`);
  const sender: EmailSender = createSmtpSender(smtp);
  return makeDispatchJob({ loadSender: () => sender, senderName: env.AVA_DISPATCH_SENDER_NAME ?? "Advokatbyrå", log });
}
