/**
 * Microsoft Graph OAuth-anslutning (#1072) — de två stegen som kräver en människa.
 *
 * Samma verktyg som `fortnox:connect`, av samma skäl: consent-rundan behövs om
 * och om igen (refresh-token dör av inaktivitet, och en misslyckad write-back i
 * CI har samma effekt), och gjord för hand blir den fel.
 *
 * Enklast — `--listen` gör hela rundan i ett svep:
 *   AVA_MS_CLIENT_ID=… AVA_MS_CLIENT_SECRET=… AVA_MS_TENANT_ID=… \
 *     AVA_MS_REDIRECT_URI=http://localhost:53682/callback bun run ms:connect --listen
 *
 * Manuellt, om redirect-URI:n inte pekar på den här maskinen — steg 1 (INGEN
 * hemlighet behövs) och steg 2 (client_secret behövs):
 *   AVA_MS_CLIENT_ID=… AVA_MS_TENANT_ID=… AVA_MS_REDIRECT_URI=… bun run ms:connect
 *   … bun run ms:connect --code <kod>
 *
 * Koden lever ~60 sekunder. Det räcker gott när man klistrar för hand, men
 * inte när något annat kommer emellan — därför finns `--listen`, som tar emot
 * redirecten själv och växlar in koden direkt (och jämför `state` åt en,
 * i stället för att be en människa göra det med ögat).
 *
 * Kör det här LOKALT, inte i CI: `client_secret` ska aldrig lämna din maskin.
 */

import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { buildAuthorizeUrl, exchangeCodeForTokens } from "@/lib/server/integrations/msgraph/oauth";
import { msGraphConfigSchema, MS_DEFAULT_SCOPES, type MsGraphConfig } from "@/lib/server/integrations/msgraph/schema";

function env(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) {
    console.error(`✗ ${name} saknas.`);
    process.exit(2);
  }
  return v ?? "";
}

function buildConfig(needSecret: boolean): MsGraphConfig {
  return msGraphConfigSchema.parse({
    clientId: env("AVA_MS_CLIENT_ID"),
    // Authorize-steget signerar inget — secreten behövs först vid token-bytet.
    clientSecret: needSecret ? env("AVA_MS_CLIENT_SECRET") : "ej-relevant-for-authorize",
    tenantId: env("AVA_MS_TENANT_ID"),
    redirectUri: env("AVA_MS_REDIRECT_URI"),
    scopes: (process.env.AVA_MS_SCOPES ?? MS_DEFAULT_SCOPES.join(" ")).split(/[ ,]+/).filter(Boolean),
  });
}

function printAuthorizeUrl(): void {
  const config = buildConfig(false);
  const state = randomUUID();
  console.log("\nÖppna den här i en browser och godkänn:\n");
  console.log(buildAuthorizeUrl(config, state));
  console.log(`\nstate = ${state}`);
  console.log("Kontrollera att samma state kommer tillbaka i redirecten (CSRF-skydd).");
  console.log("\nRedirecten går till en port där inget lyssnar — browsern visar ett");
  console.log("anslutningsfel, men adressfältet innehåller ?code=… . Kopiera den och kör:");
  console.log("  … bun run ms:connect --code <kod>");
  console.log("\nKoden är ENGÅNGS och lever ~60 sekunder — växla in den direkt.");
}

async function exchange(code: string): Promise<void> {
  const config = buildConfig(true);
  const tokens = await exchangeCodeForTokens(config, code);
  console.log("\n✓ Anslutet. Lägg det här som secret AVA_MS_REFRESH_TOKEN:\n");
  console.log(tokens.refreshToken);
  console.log(`\n(access-token går ut ${new Date(tokens.accessTokenExpiresAt).toISOString()} — den behöver du inte spara.)`);
  console.log("Refresh-token ROTERAR vid varje användning; skriv alltid tillbaka den nya.");
}

/**
 * Plocka ut `code` ur en callback-URL och kontrollera `state`.
 *
 * Ren funktion, skild från servern, för att det är HÄR det kan gå fel:
 * en avbruten consent ger `?error=…` i stället för `?code=…`, och ett `state`
 * som inte stämmer betyder att svaret hör till någon annan runda.
 */
export function codeFromCallbackUrl(rawUrl: string, expectedState: string): string {
  const p = new URL(rawUrl, "http://localhost").searchParams;
  const error = p.get("error");
  if (error) throw new Error(`${error}: ${p.get("error_description") ?? "(ingen beskrivning)"}`);
  const state = p.get("state");
  if (state !== expectedState) throw new Error(`state stämmer inte (fick ${state ?? "inget"}) — svaret hör till en annan runda`);
  const code = p.get("code");
  if (!code) throw new Error("callback saknar ?code=");
  return code;
}

/** Ta emot redirecten själv och växla in koden direkt. */
async function listen(): Promise<void> {
  const config = buildConfig(true);
  const state = randomUUID();
  const { port, pathname } = new URL(config.redirectUri);

  const received = Promise.withResolvers<string>();
  const server = createServer((req, res) => {
    const url = req.url ?? "/";
    if (!url.startsWith(pathname)) {
      res.writeHead(404).end("nej");
      return;
    }
    try {
      received.resolve(codeFromCallbackUrl(url, state));
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end("Klart — du kan stänga fliken.");
    } catch (e: unknown) {
      received.reject(e);
      res.writeHead(400, { "content-type": "text/plain; charset=utf-8" }).end("Något gick fel — se terminalen.");
    }
  });
  server.listen(Number(port));

  console.log("\nÖppna den här i en browser och godkänn:\n");
  console.log(buildAuthorizeUrl(config, state));
  console.log(`\nLyssnar på ${config.redirectUri} …`);
  try {
    await exchange(await received.promise);
  } finally {
    server.close();
  }
}

const codeIndex = process.argv.indexOf("--code");
const code = codeIndex >= 0 ? process.argv[codeIndex + 1] : undefined;
const fail = (e: unknown): void => {
  console.error(`\n✗ Anslutningen misslyckades: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
};

// Bara när scriptet körs — `codeFromCallbackUrl` ska gå att importera i test
// utan att en saknad env-variabel avslutar processen.
if (import.meta.main) {
  if (process.argv.includes("--listen")) {
    listen().catch(fail);
  } else if (code) {
    exchange(code).catch(fail);
  } else {
    printAuthorizeUrl();
  }
}
