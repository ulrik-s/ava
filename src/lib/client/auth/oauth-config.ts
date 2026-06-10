"use client";

/**
 * OAuth-konfiguration för Web. Sparas i localStorage så att olika
 * deploys (demo, firma X, firma Y) kan ha olika OAuth Apps + workers.
 *
 * I Tauri-builden behövs detta inte — `OAuthDeviceFlow`-komponenten
 * pratar direkt mot GitHub via libcurl (ingen CORS).
 */

import { z } from "zod";

import { loadFromStorage } from "@/lib/client/load-from-storage";

const STORAGE_KEY = "ava.oauthConfig";

// Zod vid parsegränsen (#187). `.catch("")` = fältvis tolerans (fel typ på
// ett fält nollar bara det fältet, som förr) — men aldrig ovaliderad data ut.
const oauthConfigSchema = z.object({
  /** URL till deployerad Cloudflare Worker (eller liknande proxy). */
  proxyUrl: z.string().catch(""),
  /** GitHub OAuth App Client ID (publik). */
  clientId: z.string().catch(""),
});

export type OAuthConfig = z.infer<typeof oauthConfigSchema>;

const DEFAULT: OAuthConfig = { proxyUrl: "", clientId: "" };

export function loadOAuthConfig(): OAuthConfig {
  return loadFromStorage(STORAGE_KEY, oauthConfigSchema, DEFAULT);
}

export function saveOAuthConfig(cfg: OAuthConfig): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

export function isOAuthConfigured(cfg: OAuthConfig = loadOAuthConfig()): boolean {
  return Boolean(cfg.proxyUrl && cfg.clientId);
}
