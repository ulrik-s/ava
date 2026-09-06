/**
 * Persistens för Fortnox-tokens (#82).
 *
 * Formen är gemensam med Graph (#1073) — samma roterande refresh-token, samma
 * krav på att överleva omstart — så mekaniken bor i `../token-store`. Här
 * återstår bara att binda den till Fortnox token-schema och valv-nyckel.
 *
 * Klassnamnen behålls: `FortnoxClient` och hela e2e-riggen konstruerar dem, och
 * ett namnbyte hade rört kod som inte har med #1073 att göra.
 */

import type { SecretsVault } from "../../secrets/vault";
import { InMemoryTokenStore, VaultTokenStore, type TokenStore } from "../token-store";
import { fortnoxStoredTokensSchema, type FortnoxStoredTokens } from "./schema";

export type FortnoxTokenStore = TokenStore<FortnoxStoredTokens>;

/** In-memory-store för tester och engångskörningar. Persisterar inget. */
export class InMemoryFortnoxTokenStore extends InMemoryTokenStore<FortnoxStoredTokens> {
  constructor(initial?: FortnoxStoredTokens) {
    super(fortnoxStoredTokensSchema, initial);
  }
}

/**
 * Persistent store backad av secrets-valvet (#79). Tokens (inkl. den roterande
 * refresh-token:en) lagras krypterat och överlever omstart.
 */
export class VaultFortnoxTokenStore extends VaultTokenStore<FortnoxStoredTokens> {
  constructor(vault: SecretsVault, key = "fortnox.tokens") {
    super(vault, fortnoxStoredTokensSchema, key);
  }
}
