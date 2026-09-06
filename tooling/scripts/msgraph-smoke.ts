#!/usr/bin/env bun
/**
 * Graph-smoke: bevisar att token-kedjan håller (#1073).
 *
 * Det här är INTE mail-e2e:t (#1074). Det enda den här körningen ska visa är
 * att rotationen fungerar obevakat — och det bevisas inte av en grön körning,
 * utan av **två i rad** där den andra autentiserar med token:en den första
 * skrev tillbaka. Därför är den avsiktligt liten: allt som kan fela av andra
 * skäl hör hemma i #1074.
 *
 * Två kontroller, båda med ett syfte:
 *
 *  - `GET /me` — att access-token:en faktiskt DUGER. Att token-endpointen
 *    svarade 200 säger inget om att Graph accepterar resultatet.
 *  - att brevlådan finns — `mail` är `null` för ett konto utan
 *    Exchange-licens, och då kommer #1074 att dö på `MailboxNotEnabledForRESTAPI`
 *    med ett felmeddelande som inte pekar på licensen. Bättre att fälla här.
 *
 * Kör i CI via .github/workflows/ms-graph-e2e.yml. Lokalt:
 *   AVA_MS_CLIENT_ID=… AVA_MS_CLIENT_SECRET=… AVA_MS_TENANT_ID=… \
 *     AVA_MS_REFRESH_TOKEN=… bun run ms:smoke
 */

import { connectGraph } from "./msgraph-harness";
import { emitRotatedToken } from "./rotated-token";

interface GraphMe {
  readonly userPrincipalName: string;
  readonly mail: string | null;
}

async function main(): Promise<void> {
  const { client, store } = await connectGraph();

  // FÖRST av allt, före något som kan fela: den gamla token:en är redan död.
  await emitRotatedToken(store);

  const me = await client.get<GraphMe>("/me");
  console.log(`• Inloggad som ${me.userPrincipalName}`);

  if (!me.mail) {
    console.error(`✗ ${me.userPrincipalName} har ingen brevlåda (mail = null).`);
    console.error("  Kontot saknar Exchange-licens. Se docs/ms-graph.md.");
    process.exit(1);
  }
  console.log(`• Brevlåda: ${me.mail}`);

  const expected = process.env.AVA_MS_TEST_MAILBOX;
  if (expected && expected.toLowerCase() !== me.mail.toLowerCase()) {
    // Inte ett fel: consent-rundan kan medvetet ha gjorts som någon annan.
    // Men det är värt att synas, för #1074 skickar TILL AVA_MS_TEST_MAILBOX.
    console.log(`⚠ AVA_MS_TEST_MAILBOX är ${expected}, men token:en tillhör ${me.mail}.`);
  }

  console.log("✓ Token-kedjan håller. Kör igen för att bevisa rotationen.");
}

main().catch((e: unknown) => {
  console.error(`✗ ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
