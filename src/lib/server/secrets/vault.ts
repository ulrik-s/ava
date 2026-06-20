/**
 * Secrets-valv (#79, ADR 0008) — krypterad nyckel/värde-store för
 * server-runtime:n (Fortnox-tokens, client-secrets, framtida SMTP-creds …).
 *
 * Designval:
 *   - **Skrivbart** — Fortnox refresh-tokens ROTERAR, så env-variabler räcker
 *     inte; valvet måste kunna skrivas i runtime och överleva omstart.
 *   - **Krypterat i vila** — hela kartan ligger som EN AES-256-GCM-blob (se
 *     crypto.ts). Master-nyckeln kommer från env, aldrig från disk.
 *   - **Utanför git-working-copy:n** — filvägen sätts separat (`AVA_SECRETS_FILE`)
 *     och får ALDRIG ligga i repo:t (secrets-in-git undviks).
 *   - **fs injicerad** (`VaultFs`) → testbar utan riktig disk.
 */

import { z } from "zod";
import { decryptSecret, encryptSecret, loadMasterKey } from "./crypto";

/**
 * Valvets på-disk-form: en platt sträng→sträng-karta. Vi zod-parsar den
 * efter dekryptering (extern data → strikt parsning) så en korrupt eller
 * manipulerad blob ger ett tydligt fel istället för att tyst flöda vidare
 * som en feltypad `Record`.
 */
const secretsMapSchema = z.record(z.string(), z.string());

export interface SecretsVault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Minimal fs-yta valvet behöver. `read` → null om filen saknas. */
export interface VaultFs {
  read(path: string): Promise<string | null>;
  write(path: string, data: string): Promise<void>;
}

export class EncryptedFileVault implements SecretsVault {
  constructor(
    private readonly filePath: string,
    private readonly key: Buffer,
    private readonly fs: VaultFs,
  ) {}

  private async loadMap(): Promise<Record<string, string>> {
    const blob = await this.fs.read(this.filePath);
    if (!blob) return {};
    return secretsMapSchema.parse(JSON.parse(decryptSecret(blob, this.key)));
  }

  private async saveMap(map: Record<string, string>): Promise<void> {
    await this.fs.write(this.filePath, encryptSecret(JSON.stringify(map), this.key));
  }

  async get(key: string): Promise<string | null> {
    return (await this.loadMap())[key] ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    const map = await this.loadMap();
    map[key] = value;
    await this.saveMap(map);
  }

  async delete(key: string): Promise<void> {
    const map = await this.loadMap();
    delete map[key];
    await this.saveMap(map);
  }
}

/**
 * Bygg valvet från env (server-runtime, ADR 0008):
 *   - `AVA_SECRETS_KEY`  base64-kodade 32 byte master-nyckel.
 *   - `AVA_SECRETS_FILE` sökväg till valv-filen (UTANFÖR git-working-copy:n).
 */
export function createVaultFromEnv(env: NodeJS.ProcessEnv = process.env): SecretsVault {
  const key = loadMasterKey(env.AVA_SECRETS_KEY);
  const file = env.AVA_SECRETS_FILE;
  if (!file) {
    throw new Error("AVA_SECRETS_FILE saknas — sökväg till valv-filen (utanför git-working-copy:n).");
  }
  return new EncryptedFileVault(file, key, nodeVaultFs());
}

/** Node-fs-impl: atomisk skrivning (tmp + rename) med 0600-rättigheter. */
export function nodeVaultFs(): VaultFs {
  return {
    async read(path: string): Promise<string | null> {
      const { readFile } = await import("node:fs/promises");
      try {
        return await readFile(path, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async write(path: string, data: string): Promise<void> {
      const { writeFile, rename, mkdir } = await import("node:fs/promises");
      const { dirname } = await import("node:path");
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, data, { mode: 0o600 });
      await rename(tmp, path);
    },
  };
}
