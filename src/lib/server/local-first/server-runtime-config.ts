/**
 * Server-runtime D (#118, ADR 0005 fas 1) — körbar konfiguration.
 *
 * Läser runtime-konfigen ur miljövariabler (12-factor) och validerar med zod,
 * så den körbara entryn (`src/bin/server-runtime.ts`) bara behöver anropa
 * {@link loadRuntimeConfig} och få ett färdigvaliderat, typat objekt.
 *
 * Inga hemligheter här: git-creds tas av systemets git-config/credential-
 * helper (SSH-agent, HTTPS-helper), precis som `NodeGitOps`/`cloneWorkingCopy`
 * redan förutsätter. Vi skickar alltså aldrig lösenord/tokens via env.
 */

import { z } from "zod";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;

export const runtimeConfigSchema = z.object({
  /** Remote-url till firma.git (file://, https:// eller ssh). */
  repoUrl: z.string().min(1),
  /** Katalog för server-peerns egna working copy (klonas hit om tom). */
  workDir: z.string().min(1),
  /** Branch att synka mot. */
  branch: z.string().min(1).default("main"),
  /** Git-remote-namn. */
  remote: z.string().min(1).default("origin"),
  /** Polling-intervall för peer-loopen, i ms. */
  pollIntervalMs: z.coerce.number().int().positive().default(DEFAULT_POLL_INTERVAL_MS),
  /** Max push-försök vid NonFastForward-konflikt per cykel. */
  maxRetries: z.coerce.number().int().positive().default(DEFAULT_MAX_RETRIES),
  /**
   * Port för det additiva tRPC-over-HTTP-API:t (#83, ADR 0013). Utelämnas →
   * inget API monteras (ren git-peer, oförändrat beteende). Aktiveras bara
   * tillsammans med minst en `apiToken`.
   */
  httpPort: z.coerce.number().int().positive().optional(),
  /**
   * Lyssna-adress för API:t. Default 127.0.0.1 (loopback, säkrast). I docker
   * sätts 0.0.0.0 så nginx-fronten i en annan container kan proxa hit.
   */
  httpHost: z.string().min(1).default("127.0.0.1"),
  /**
   * Bearer-PAT:er som auktoriserar mot API:t (ADR 0013 §3 C1). Alla mappar
   * till `principal` (maskin-principal-vägen). Tomt → API:t monteras inte.
   */
  apiTokens: z.array(z.string().min(1)).default([]),
  /**
   * Self-deklarerad principal (git-backenden har ingen ACL, ADR 0001). Blir
   * också git-författare för commits. Bara `organizationId` är obligatorisk;
   * övriga fält har körbara defaults.
   */
  principal: z.object({
    id: z.string().min(1).default("server-runtime"),
    email: z.string().min(1).default("server-runtime@ava.local"),
    name: z.string().min(1).default("AVA Server-runtime"),
    role: z.string().min(1).default("ADMIN"),
    organizationId: z.string().min(1),
  }),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

/** Env-nyckel → schemats fält. Single source of truth för dokumentation + parse. */
export const ENV_KEYS = {
  repoUrl: "AVA_SR_REPO_URL",
  workDir: "AVA_SR_WORK_DIR",
  branch: "AVA_SR_BRANCH",
  remote: "AVA_SR_REMOTE",
  pollIntervalMs: "AVA_SR_POLL_INTERVAL_MS",
  maxRetries: "AVA_SR_MAX_RETRIES",
  httpPort: "AVA_SR_API_PORT",
  httpHost: "AVA_SR_API_HOST",
  apiTokens: "AVA_SR_API_TOKENS",
  principalId: "AVA_SR_PRINCIPAL_ID",
  principalEmail: "AVA_SR_PRINCIPAL_EMAIL",
  principalName: "AVA_SR_PRINCIPAL_NAME",
  principalRole: "AVA_SR_PRINCIPAL_ROLE",
  organizationId: "AVA_SR_ORG_ID",
} as const;

/** Läs en env-nyckel; tom sträng behandlas som ej satt (→ schemats default slår in). */
function read(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === "" ? undefined : value;
}

/** Komma-separerad token-lista → trimmad array (tomma element bort). `undefined`
 *  när env saknas, så schemats default `[]` slår in. */
function parseTokens(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const tokens = raw.split(",").map((t) => t.trim()).filter((t) => t.length > 0);
  return tokens.length > 0 ? tokens : undefined;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "(rot)"}: ${issue.message}`)
    .join("\n");
}

/**
 * Bygg och validera runtime-konfigen ur miljövariabler. Kastar med en läsbar
 * sammanställning av alla fel (inte bara det första) om något saknas/är fel.
 */
export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const parsed = runtimeConfigSchema.safeParse({
    repoUrl: read(env, ENV_KEYS.repoUrl),
    workDir: read(env, ENV_KEYS.workDir),
    branch: read(env, ENV_KEYS.branch),
    remote: read(env, ENV_KEYS.remote),
    pollIntervalMs: read(env, ENV_KEYS.pollIntervalMs),
    maxRetries: read(env, ENV_KEYS.maxRetries),
    httpPort: read(env, ENV_KEYS.httpPort),
    httpHost: read(env, ENV_KEYS.httpHost),
    apiTokens: parseTokens(read(env, ENV_KEYS.apiTokens)),
    principal: {
      id: read(env, ENV_KEYS.principalId),
      email: read(env, ENV_KEYS.principalEmail),
      name: read(env, ENV_KEYS.principalName),
      role: read(env, ENV_KEYS.principalRole),
      organizationId: read(env, ENV_KEYS.organizationId),
    },
  });
  if (!parsed.success) {
    throw new Error(`Ogiltig server-runtime-konfig:\n${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}
