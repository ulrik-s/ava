/**
 * Fortnox OAuth-anslutning (#1030) — de två stegen som kräver en människa.
 *
 * README:n har sagt "kräver dig" sedan #82 utan att erbjuda ett verktyg, så
 * consent-rundan har gjorts för hand varje gång. Den behövs om och om igen:
 * refresh-token dör efter 45 dygn utan användning, och en misslyckad
 * write-back i CI har samma effekt.
 *
 * Steg 1 — bygg authorize-URL:en (INGEN hemlighet behövs):
 *   AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_REDIRECT_URI=… bun tooling/scripts/fortnox-connect.ts
 *
 * Steg 2 — växla in koden ur redirecten (client_secret behövs):
 *   AVA_FORTNOX_CLIENT_ID=… AVA_FORTNOX_CLIENT_SECRET=… AVA_FORTNOX_REDIRECT_URI=… \
 *     bun tooling/scripts/fortnox-connect.ts --code <kod>
 *
 * Kör det här LOKALT, inte i CI: `client_secret` ska aldrig lämna din maskin,
 * och `code` är kortlivad och engångs.
 */

import { randomUUID } from "node:crypto";
import { buildAuthorizeUrl, exchangeCodeForTokens } from "@/lib/server/integrations/fortnox/oauth";
import { fortnoxConfigSchema, type FortnoxConfig } from "@/lib/server/integrations/fortnox/schema";

function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) {
    console.error(`✗ ${name} saknas.`);
    process.exit(2);
  }
  return v ?? "";
}

function buildConfig(needSecret: boolean): FortnoxConfig {
  return fortnoxConfigSchema.parse({
    clientId: env("AVA_FORTNOX_CLIENT_ID"),
    // Authorize-steget signerar inget — secreten behövs först vid token-bytet.
    clientSecret: needSecret ? env("AVA_FORTNOX_CLIENT_SECRET") : "ej-relevant-for-authorize",
    redirectUri: env("AVA_FORTNOX_REDIRECT_URI"),
    scopes: (process.env.AVA_FORTNOX_SCOPES ?? "bookkeeping").split(/[ ,]+/).filter(Boolean),
    ...(process.env.AVA_FORTNOX_ACCOUNT_TYPE === "service" ? { accountType: "service" as const } : {}),
  });
}

function printAuthorizeUrl(): void {
  const config = buildConfig(false);
  const state = randomUUID();
  console.log("\nÖppna den här i en browser och godkänn:\n");
  console.log(buildAuthorizeUrl(config, state));
  console.log(`\nstate = ${state}`);
  console.log("Kontrollera att samma state kommer tillbaka i redirecten (CSRF-skydd).");
  console.log("\nKopiera sedan ?code=… ur adressfältet och kör:");
  console.log("  … bun tooling/scripts/fortnox-connect.ts --code <kod>");
  console.log("\nKoden är ENGÅNGS och kortlivad — växla in den direkt.");
}

async function exchange(code: string): Promise<void> {
  const config = buildConfig(true);
  const tokens = await exchangeCodeForTokens(config, code);
  console.log("\n✓ Anslutet. Lägg det här som secret AVA_FORTNOX_REFRESH_TOKEN:\n");
  console.log(tokens.refreshToken);
  console.log(`\n(access-token går ut ${new Date(tokens.accessTokenExpiresAt).toISOString()} — den behöver du inte spara.)`);
  console.log("Refresh-token ROTERAR vid varje användning; se docs/fortnox-e2e.md.");
}

const codeIndex = process.argv.indexOf("--code");
const code = codeIndex >= 0 ? process.argv[codeIndex + 1] : undefined;

if (!code) {
  printAuthorizeUrl();
} else {
  exchange(code).catch((e: unknown) => {
    console.error(`\n✗ Token-bytet misslyckades: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  });
}
