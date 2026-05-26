"use client";

/**
 * OAuth-konfiguration för Web. Sparas i localStorage så att olika
 * deploys (demo, firma X, firma Y) kan ha olika OAuth Apps + workers.
 *
 * I Tauri-builden behövs detta inte — `OAuthDeviceFlow`-komponenten
 * pratar direkt mot GitHub via libcurl (ingen CORS).
 */

const STORAGE_KEY = "ava.oauthConfig";

export interface OAuthConfig {
  /** URL till deployerad Cloudflare Worker (eller liknande proxy). */
  proxyUrl: string;
  /** GitHub OAuth App Client ID (publik). */
  clientId: string;
}

const DEFAULT: OAuthConfig = { proxyUrl: "", clientId: "" };

export function loadOAuthConfig(): OAuthConfig {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<OAuthConfig>;
    return {
      proxyUrl: typeof parsed.proxyUrl === "string" ? parsed.proxyUrl : "",
      clientId: typeof parsed.clientId === "string" ? parsed.clientId : "",
    };
  } catch {
    return DEFAULT;
  }
}

export function saveOAuthConfig(cfg: OAuthConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function isOAuthConfigured(cfg: OAuthConfig = loadOAuthConfig()): boolean {
  return Boolean(cfg.proxyUrl && cfg.clientId);
}
