/**
 * Persistens för Fortnox-tokens (#82).
 *
 * Refresh-token roterar vid varje refresh, så den MÅSTE överleva
 * server-omstarter — annars tappar vi kopplingen och byrån måste re-autha.
 * Lagringen är abstraherad: in-memory (test/dev) eller `VaultFortnoxTokenStore`
 * backad av secrets-valvet (#79) i skarp drift — samma interface, resten av
 * connectorn oförändrad.
 */

import { fortnoxStoredTokensSchema, type FortnoxStoredTokens } from "./schema";
import type { SecretsVault } from "../../secrets/vault";

export interface FortnoxTokenStore {
  /** Hämta sparade tokens, eller null om byrån inte auth:at än. */
  load(): Promise<FortnoxStoredTokens | null>;
  /** Spara (skriv över) tokens — anropas efter varje refresh (rotation!). */
  save(tokens: FortnoxStoredTokens): Promise<void>;
}

/** In-memory-store för tester och engångskörningar. Persisterar inget. */
export class InMemoryFortnoxTokenStore implements FortnoxTokenStore {
  private tokens: FortnoxStoredTokens | null;

  constructor(initial?: FortnoxStoredTokens) {
    this.tokens = initial ?? null;
  }

  async load(): Promise<FortnoxStoredTokens | null> {
    return this.tokens;
  }

  async save(tokens: FortnoxStoredTokens): Promise<void> {
    // Strikt parsning även internt — fångar trasig data tidigt.
    this.tokens = fortnoxStoredTokensSchema.parse(tokens);
  }
}

/**
 * Persistent store backad av secrets-valvet (#79). Tokens (inkl. den roterande
 * refresh-token:en) lagras krypterat och överlever omstart.
 */
export class VaultFortnoxTokenStore implements FortnoxTokenStore {
  constructor(
    private readonly vault: SecretsVault,
    private readonly key: string = "fortnox.tokens",
  ) {}

  async load(): Promise<FortnoxStoredTokens | null> {
    const raw = await this.vault.get(this.key);
    if (!raw) return null;
    return fortnoxStoredTokensSchema.parse(JSON.parse(raw));
  }

  async save(tokens: FortnoxStoredTokens): Promise<void> {
    await this.vault.set(this.key, JSON.stringify(fortnoxStoredTokensSchema.parse(tokens)));
  }
}
