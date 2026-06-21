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
