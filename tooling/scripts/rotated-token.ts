/**
 * Write-back av en roterad refresh-token till `$GITHUB_OUTPUT` (#1073).
 *
 * Både Fortnox och Entra utfärdar en NY refresh-token vid varje refresh och
 * dödar den gamla. En secret utan write-back räcker därför till exakt en
 * körning — och nästa körning dör i auth, långt från orsaken.
 *
 * Tre saker Fortnox lärde oss, och som gäller ordagrant för Graph:
 *
 *  1. **Emitta direkt efter FÖRSTA refreshen.** Den gamla token:en är död från
 *     den sekunden. Faller något senare i körningen är den nya förlorad om den
 *     inte redan skrivits ut.
 *  2. **Write-back-steget i workflowet måste köras med `if: always()`**, av
 *     samma skäl.
 *  3. **Step-outputs maskeras INTE automatiskt.** `::add-mask::` måste skrivas
 *     innan värdet går till `$GITHUB_OUTPUT`, annars kan ett senare steg eka
 *     det i klartext.
 */

import { appendFileSync } from "node:fs";

import type { TokenStore } from "@/lib/server/integrations/token-store";

/** Det enda vi behöver av en token-shape här. */
interface HasRefreshToken {
  readonly refreshToken: string;
}

/**
 * Skriv storens nuvarande refresh-token till `$GITHUB_OUTPUT` som `refresh_token`.
 *
 * Tyst no-op utanför GitHub Actions (ingen `$GITHUB_OUTPUT`) och när storen är
 * tom — lokala körningar ska inte behöva bry sig, och ett tomt store betyder
 * att ingen refresh hunnit ske.
 */
export async function emitRotatedToken<T extends HasRefreshToken>(
  store: TokenStore<T>,
  outPath: string | undefined = process.env.GITHUB_OUTPUT,
): Promise<void> {
  if (!outPath) return;
  const rotated = await store.load();
  if (!rotated) return;
  console.log(`::add-mask::${rotated.refreshToken}`);
  appendFileSync(outPath, `refresh_token=${rotated.refreshToken}\n`);
  console.log("• Roterad refresh-token skriven till GITHUB_OUTPUT (maskerad).");
}
