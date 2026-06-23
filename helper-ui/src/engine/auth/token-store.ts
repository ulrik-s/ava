/**
 * Token-lagring i OS-keychain (ADR 0028 §2, jfr ADR 0006 keychain-trust).
 *
 * macOS först (`security` generic-password) — samma plattforms-scope som
 * helperns CA-trust (`tls/trust.ts`). Rena arg-byggare + en injicerbar runner
 * (fångar stdout för läsning) → testbart utan att röra riktiga keychain:en;
 * den faktiska keychain-mutationen verifieras manuellt på Mac.
 *
 * Tokens (access/refresh) är känsliga → de hör hemma i keychain:en, aldrig i
 * klartext-fil. En `InMemoryTokenStore` finns för tester/fallback.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { Platform } from "../platform/runtime.ts";
import type { TokenSet } from "./oidc.ts";

const ACCOUNT = "ava-helper";
const SERVICE = "ava-helper-oidc-token";

export interface TokenStore {
  load(): Promise<TokenSet | null>;
  save(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

/** Runner som fångar status + stdout (`security find-...-w` skriver secret:en till stdout). */
export interface CaptureRunner {
  (cmd: string, args: readonly string[]): { status: number | null; stdout: string };
}

const defaultRunner: CaptureRunner = (cmd, args) => {
  const r = spawnSync(cmd, [...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout ?? "" };
};

// ─── Rena `security`-argument ────────────────────────────────────────
export function saveArgs(secret: string): string[] {
  // -U = uppdatera om den finns (idempotent). -w <secret> = lösenordsvärdet.
  return ["add-generic-password", "-U", "-a", ACCOUNT, "-s", SERVICE, "-w", secret];
}
export function loadArgs(): string[] {
  return ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"];
}
export function clearArgs(): string[] {
  return ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE];
}

/** Tolka en lagrad secret-sträng → TokenSet, eller null vid trasig/saknad. */
export function parseStored(raw: string): TokenSet | null {
  const text = raw.trim();
  if (text === "") return null;
  try {
    const t = JSON.parse(text) as Partial<TokenSet>;
    if (typeof t.accessToken !== "string" || typeof t.expiresAt !== "number") return null;
    return {
      accessToken: t.accessToken,
      expiresAt: t.expiresAt,
      ...(typeof t.refreshToken === "string" ? { refreshToken: t.refreshToken } : {}),
      ...(typeof t.idToken === "string" ? { idToken: t.idToken } : {}),
    };
  } catch {
    return null;
  }
}

/** macOS-keychain-backad store (via `security`). */
export class KeychainTokenStore implements TokenStore {
  constructor(private readonly run: CaptureRunner = defaultRunner) {}

  load(): Promise<TokenSet | null> {
    const res = this.run("security", loadArgs());
    return Promise.resolve(res.status === 0 ? parseStored(res.stdout) : null);
  }

  save(tokens: TokenSet): Promise<void> {
    this.run("security", saveArgs(JSON.stringify(tokens)));
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.run("security", clearArgs());
    return Promise.resolve();
  }
}

/** In-memory store för tester/fallback (ingen persistens). */
export class InMemoryTokenStore implements TokenStore {
  private tokens: TokenSet | null = null;
  load(): Promise<TokenSet | null> {
    return Promise.resolve(this.tokens);
  }
  save(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.tokens = null;
    return Promise.resolve();
  }
}

/**
 * Fil-backad token-store (headless/Linux). macOS-keychain finns inte på Linux,
 * och en GUI-keychain passar ändå inte en headless-körning (CI, server-helper,
 * #742). Tokens läggs då i en fil (0600) i data-katalogen. Känsligt men det är
 * priset för headless utan keychain — på macOS föredras alltid keychain.
 */
export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}
  load(): Promise<TokenSet | null> {
    try {
      return Promise.resolve(parseStored(readFileSync(this.path, "utf8")));
    } catch {
      return Promise.resolve(null); // saknad/oläsbar fil → ej parad
    }
  }
  save(tokens: TokenSet): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(tokens), { mode: 0o600 });
    return Promise.resolve();
  }
  clear(): Promise<void> {
    try { rmSync(this.path); } catch { /* redan borta */ }
    return Promise.resolve();
  }
}

/** Filnamn för fil-storen i data-katalogen. */
export const TOKEN_FILE_NAME = "oidc-token.json";

/**
 * Välj token-store: explicit fil via `AVA_HELPER_TOKEN_FILE` (headless/test),
 * annars keychain på macOS, annars en fil i data-katalogen (Linux/headless —
 * keychain saknas). Utan data-katalog (`dir === null`) faller vi tillbaka på
 * in-memory (ingen persistens, men auth fungerar inom processens livstid).
 * Ren funktion (platform + dir + env in) → testbar utan riktig fs/keychain.
 */
export function selectTokenStore(
  platform: Platform,
  dir: string | null,
  env: { tokenFile?: string | undefined } = {},
): TokenStore {
  if (env.tokenFile) return new FileTokenStore(env.tokenFile);
  if (platform === "darwin") return new KeychainTokenStore();
  if (dir !== null) return new FileTokenStore(join(dir, TOKEN_FILE_NAME));
  return new InMemoryTokenStore();
}
