/**
 * Per installation: manifestet och config.js för Outlook-tillägget, ur
 * miljön som deployen redan har (tooling/scripts/deploy-prod.sh).
 *
 *   AVA_DOMAIN              t.ex. ava-crm.io → https://ava-crm.io/addin
 *   AVA_ADDIN_BASE_URL      eller en hel bas-URL (lokalt: https://localhost:3443)
 *   OAUTH2_PROXY_CLIENT_ID  AVA-appens klient-id (samma app som webbinloggningen)
 *   OIDC_ISSUER_URL         https://login.microsoftonline.com/<tenant>/v2.0
 *   AVA_VERSION             release-taggen, t.ex. v0.7.20 → manifestets Version
 *
 * Rena funktioner: build.ts skriver filerna, testerna kontrollerar innehållet.
 */

import type { AddinConfig } from "@/lib/client/addin/addin-auth";
import { entraAppConfig } from "@/lib/shared/office365-config";

type Env = Record<string, string | undefined>;
const value = (env: Env, key: string): string | undefined => env[key]?.trim() || undefined;

/** Var tillägget serveras, utan avslutande snedstreck. */
export function addinBaseUrl(env: Env): string {
  const explicit = value(env, "AVA_ADDIN_BASE_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const domain = value(env, "AVA_DOMAIN");
  return domain ? `https://${domain}/addin` : "https://localhost:3443";
}

/** `v0.7.20`, `v0.7.20-3-gabc123` → `0.7.20`. Okänt → `0.0.0`. */
export function manifestVersion(env: Env): string {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(value(env, "AVA_VERSION") ?? "");
  return m ? `${m[1]}.${m[2]}.${m[3]}` : "0.0.0";
}

/** Tilläggets konfiguration, eller null om installationen saknar Entra-uppgifter. */
export function addinConfigFromEnv(env: Env): AddinConfig | null {
  return entraAppConfig({
    clientId: value(env, "OAUTH2_PROXY_CLIENT_ID"),
    issuer: value(env, "OIDC_ISSUER_URL"),
    clientIdOverride: value(env, "AVA_ADDIN_CLIENT_ID"),
    tenantIdOverride: value(env, "AVA_ADDIN_TENANT_ID"),
  });
}

/** config.js: sätter `window.AVA_ADDIN` (läses av taskpane.ts). */
export function renderConfigJs(config: AddinConfig | null): string {
  return `// Genererad av office-addin/build.ts — per installation.\nwindow.AVA_ADDIN = ${config ? JSON.stringify(config) : "undefined"};\n`;
}

/** Manifestet ur mallen (office-addin/manifests/outlook-manifest.xml). */
export function renderManifest(template: string, opts: { base: string; version: string }): string {
  const xmlSafe = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  return template.replaceAll("{{BASE}}", xmlSafe(opts.base)).replaceAll("{{VERSION}}", xmlSafe(opts.version));
}
