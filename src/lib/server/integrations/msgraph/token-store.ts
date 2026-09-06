/**
 * Persistens för Graph-tokens (#1073).
 *
 * Entra utfärdar en ny refresh-token vid varje refresh och den gamla ska
 * kastas. Utan write-back räcker ett token i en secret till **exakt en
 * körning** — samma failure-mode som Fortnox, och samma lösning.
 */

import type { SecretsVault } from "../../secrets/vault";
import { InMemoryTokenStore, VaultTokenStore } from "../token-store";
import { msStoredTokensSchema, type MsStoredTokens } from "./schema";

/** In-memory-store för tester och engångskörningar (t.ex. CI). */
export class InMemoryGraphTokenStore extends InMemoryTokenStore<MsStoredTokens> {
  constructor(initial?: MsStoredTokens) {
    super(msStoredTokensSchema, initial);
  }
}

/** Persistent store backad av secrets-valvet (#79, ADR 0008). */
export class VaultGraphTokenStore extends VaultTokenStore<MsStoredTokens> {
  constructor(vault: SecretsVault, key = "msgraph.tokens") {
    super(vault, msStoredTokensSchema, key);
  }
}
