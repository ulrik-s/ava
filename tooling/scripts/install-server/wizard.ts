/**
 * Konfigurations-modell för install-server (#232) — gör att en icke-devops-byrå
 * kan fylla i en JSON-mall (`--print-config-template` → redigera →
 * `--config fil.json`) i stället för att kunna alla flaggor. Ren logik
 * (fält-definitioner + svar→config + mall-rendering) bor här.
 *
 * Samma `answersToConfig` används av BÅDE flagg-vägen (argv→answers) och
 * config-fil-vägen → en sanningskälla för config-byggandet.
 */

import type { OidcInstallConfig, ServerInstallConfig } from "./core";

export interface ConfigField {
  /** Nyckel i config/answers-mappen (= flaggnamn utan `--`). */
  key: string;
  /** Människoläsbar beskrivning (mall-kommentar). */
  question: string;
  default?: string;
}

/** Grundfält (alltid). */
export const BASE_FIELDS: readonly ConfigField[] = [
  { key: "repo", question: "Git-repo-URL till firma.git" },
  { key: "work-dir", question: "Katalog för server-runtime:ns working-copy" },
  { key: "org", question: "Organisations-id (UUID)" },
  { key: "auth", question: "Auth-läge: htpasswd eller oidc", default: "htpasswd" },
];

/** Extra fält när auth-läget är OIDC. */
export const OIDC_FIELDS: readonly ConfigField[] = [
  { key: "oidc-issuer", question: "OIDC issuer-URL" },
  { key: "oidc-client-id", question: "OIDC client-id" },
  { key: "oidc-client-secret", question: "OIDC client-secret (skrivs i valvet, ej i .env)" },
  { key: "oidc-redirect", question: "OIDC redirect-URL" },
];

/** Alla fält givet (ev. valt) auth-läge. */
export function fieldsFor(authMode: string | undefined): readonly ConfigField[] {
  return authMode === "oidc" ? [...BASE_FIELDS, ...OIDC_FIELDS] : BASE_FIELDS;
}

/**
 * Rendera en JSON-mall (alla fält tomma + en `_help`-karta key→beskrivning).
 * Byrån fyller i den och kör `--config fil.json`.
 */
export function renderConfigTemplate(): string {
  const all = fieldsFor("oidc"); // alla fält (bas + oidc) i mallen
  const fields: Record<string, string> = {};
  const help: Record<string, string> = {};
  for (const f of all) {
    fields[f.key] = f.default ?? "";
    help[f.key] = f.question;
  }
  return JSON.stringify({ _help: help, ...fields }, null, 2) + "\n";
}

/** Parsa + validera en config-fil till en answers-map (strängvärden). */
export function parseConfigFile(json: string): Record<string, string> {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("config-filen måste vara ett JSON-objekt");
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (k === "_help") continue;
    if (typeof v === "string" && v !== "") out[k] = v;
  }
  return out;
}

function oidcFromAnswers(a: Record<string, string | undefined>): OidcInstallConfig {
  return {
    issuerUrl: a["oidc-issuer"] ?? "",
    clientId: a["oidc-client-id"] ?? "",
    clientSecret: a["oidc-client-secret"] ?? "",
    redirectUrl: a["oidc-redirect"] ?? "",
  };
}

/** Bygg install-config ur en svar-/flagg-map. Enda config-byggaren. */
export function answersToConfig(
  answers: Record<string, string | undefined>,
  secretsFile: string,
): ServerInstallConfig {
  const authMode = answers.auth === "oidc" ? "oidc" : "htpasswd";
  return {
    repoUrl: answers.repo ?? "",
    workDir: answers["work-dir"] ?? "",
    organizationId: answers.org ?? "",
    secretsFile,
    authMode,
    ...(authMode === "oidc" ? { oidc: oidcFromAnswers(answers) } : {}),
  };
}
