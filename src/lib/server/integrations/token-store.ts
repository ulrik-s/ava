/**
 * Persistens för OAuth-tokens (#1073).
 *
 * Fortnox och Microsoft Graph har samma problem och samma lösning: refresh-
 * token roterar vid varje användning, så den MÅSTE överleva en omstart —
 * annars tappar vi kopplingen och byrån får autentisera om. Lagringen är
 * abstraherad: in-memory (test/engångskörningar) eller valv-backad (#79,
 * ADR 0008) i skarp drift, med samma interface.
 *
 * Generisk över token-formen i stället för en kopia per integration. Schemat
 * skickas in så att strikt parsning sker även internt
 * ([[feedback-zod-strict-parsing]]) — en korrupt blob i valvet ska fälla vid
 * läsning, inte flöda vidare som feltypad data.
 */

import type { ZodType } from "zod";

import type { SecretsVault } from "../secrets/vault";

export interface TokenStore<T> {
  /** Hämta sparade tokens, eller null om ingen anslutning gjorts än. */
  load(): Promise<T | null>;
  /** Spara (skriv över) tokens — anropas efter varje refresh (rotation!). */
  save(tokens: T): Promise<void>;
}

/** In-memory-store för tester och engångskörningar. Persisterar inget. */
export class InMemoryTokenStore<T> implements TokenStore<T> {
  private tokens: T | null;

  constructor(
    private readonly schema: ZodType<T>,
    initial?: T,
  ) {
    this.tokens = initial ?? null;
  }

  async load(): Promise<T | null> {
    return this.tokens;
  }

  async save(tokens: T): Promise<void> {
    this.tokens = this.schema.parse(tokens);
  }
}

/**
 * Persistent store backad av secrets-valvet. Tokens (inkl. den roterande
 * refresh-token:en) lagras krypterat och överlever omstart.
 */
export class VaultTokenStore<T> implements TokenStore<T> {
  constructor(
    private readonly vault: SecretsVault,
    private readonly schema: ZodType<T>,
    private readonly key: string,
  ) {}

  async load(): Promise<T | null> {
    const raw = await this.vault.get(this.key);
    if (!raw) return null;
    return this.schema.parse(JSON.parse(raw));
  }

  async save(tokens: T): Promise<void> {
    await this.vault.set(this.key, JSON.stringify(this.schema.parse(tokens)));
  }
}
