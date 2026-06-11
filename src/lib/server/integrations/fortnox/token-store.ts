/**
 * Persistens för Fortnox-tokens (#82).
 *
 * Refresh-token roterar vid varje refresh, så den MÅSTE överleva
 * server-omstarter — annars tappar vi kopplingen och byrån måste re-autha.
 * Lagringen är abstraherad: in-memory nu (test/dev), riktig backend (krypterat
 * i git-db eller secrets-valv #79) kopplas in via samma interface utan att
 * resten av connectorn ändras.
 */

import { fortnoxStoredTokensSchema, type FortnoxStoredTokens } from "./schema";

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
