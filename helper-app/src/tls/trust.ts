/**
 * macOS trust-injection av helperns lokala CA (#103, ADR 0006). Lägger
 * CA-roten i användarens login-keychain så Safari/WKWebView litar på
 * leaf-certet. ENDAST macOS — Chromium/Firefox/Windows-WebView2 hedrar
 * loopback-secure-context och behöver ingen trust.
 *
 * Kommando-byggarna är rena (testbara); `security`-anropen går via en
 * injicerbar runner. Den faktiska keychain-mutationen kräver en interaktiv
 * auktoriseringsprompt och kan inte CI-testas — verifieras manuellt på Mac.
 */

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

import { currentPlatform, type Platform } from "../platform/runtime.ts";
import { CA_COMMON_NAME } from "./certs.ts";

export interface Runner {
  (cmd: string, args: readonly string[]): { status: number | null };
}

const defaultRunner: Runner = (cmd, args) => {
  const r = spawnSync(cmd, [...args], { stdio: "inherit" });
  return { status: r.status };
};

export function loginKeychain(home: string): string {
  return join(home, "Library", "Keychains", "login.keychain-db");
}

// ─── Rena kommando-argument (security ...) ───────────────────────────
export function addTrustedArgs(caCertPath: string, keychain: string): string[] {
  // Användar-domän (inget -d → ingen sudo); -r trustRoot = betrodd rot.
  return ["add-trusted-cert", "-r", "trustRoot", "-k", keychain, caCertPath];
}
export function verifyCertArgs(caCertPath: string): string[] {
  return ["verify-cert", "-c", caCertPath];
}
export function removeTrustArgs(caCertPath: string): string[] {
  return ["remove-trusted-cert", caCertPath];
}
export function deleteCertArgs(): string[] {
  return ["delete-certificate", "-c", CA_COMMON_NAME, "-t"];
}

export interface TrustDeps {
  platform?: Platform;
  run?: Runner;
  keychain?: string;
}
export interface TrustResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
}

/** Installera CA-roten som betrodd (idempotent). */
export function installCaTrust(caCertPath: string, deps: TrustDeps = {}): TrustResult {
  const platform = deps.platform ?? currentPlatform();
  if (platform !== "darwin") {
    return { ok: false, skipped: true, reason: `trust-injection stöds bara på macOS (är: ${platform})` };
  }
  const run = deps.run ?? defaultRunner;
  const keychain = deps.keychain ?? loginKeychain(homedir());
  if (run("security", verifyCertArgs(caCertPath)).status === 0) {
    return { ok: true, skipped: true, reason: "redan betrott" };
  }
  return { ok: run("security", addTrustedArgs(caCertPath, keychain)).status === 0, skipped: false };
}

/** Ta bort CA-roten ur trust-store + keychain. */
export function removeCaTrust(caCertPath: string, deps: TrustDeps = {}): TrustResult {
  const platform = deps.platform ?? currentPlatform();
  if (platform !== "darwin") {
    return { ok: false, skipped: true, reason: `endast macOS (är: ${platform})` };
  }
  const run = deps.run ?? defaultRunner;
  run("security", removeTrustArgs(caCertPath));
  run("security", deleteCertArgs());
  return { ok: true, skipped: false };
}
