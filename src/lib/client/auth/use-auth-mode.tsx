"use client";

/**
 * `useAuthMode` — React-hook + context som exponerar nuvarande
 * auth-mode (anonymous / identified-read / identified-write).
 *
 * Source of truth:
 *   - FirmaConfig.repo (vilken repo det handlar om)
 *   - FirmaConfig.token (vald token)
 *   - settings.allowAnonymousRead (om Tier 2/3 vill stänga av läs
 *     för oidentifierade besökare)
 *
 * Hooken triggar detectAuthMode mot GitHub API vid mount + när
 * token/repo ändras. Resultatet cachas i ett provider-context så
 * sidopanelen, mutation-knappar etc. kan reagera direkt.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { z } from "zod";
import { loadFromStorage } from "@/lib/client/load-from-storage";
import { detectAuthMode, getCurrentUser, type AuthMode, type GitHubUser } from "./github-auth";

const SETTINGS_KEY = "ava.authSettings";

export interface AuthSettings {
  /**
   * När `false` får inga oidentifierade besökare läsa repo:t.
   * Tier 2/3-admin kan slå av detta. Default `true` (demo-mode).
   */
  allowAnonymousRead: boolean;
}

// Zod vid parsegränsen (#187): inga ovaliderade spreads in i access-konfig.
const authSettingsSchema = z.object({ allowAnonymousRead: z.boolean().catch(true) });

export function loadAuthSettings(): AuthSettings {
  return loadFromStorage(SETTINGS_KEY, authSettingsSchema, { allowAnonymousRead: true });
}

export function saveAuthSettings(s: AuthSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export interface AuthState {
  mode: AuthMode;
  /** Inloggad användare (om identifierad). Null annars. */
  user: GitHubUser | null;
  /** True medan mode beräknas första gången. */
  loading: boolean;
  /** Eventuellt error från detect. */
  error: string | null;
  /**
   * När `allowAnonymousRead === false` och mode === "anonymous":
   * Visa "Logga in"-skärm istället för data.
   */
  shouldRequireLogin: boolean;
  /** Tvinga om-detection (anropas efter token-byte). */
  refresh: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export interface AuthProviderProps {
  token: string;
  repoUrl: string;
  children: ReactNode;
  /** Override för tester. */
  detect?: typeof detectAuthMode;
  fetchUser?: typeof getCurrentUser;
  settings?: AuthSettings;
}

export function AuthProvider(props: AuthProviderProps) {
  const detect = props.detect ?? detectAuthMode;
  const fetchUser = props.fetchUser ?? getCurrentUser;
  const settings = useMemo(() => props.settings ?? loadAuthSettings(), [props.settings]);
  const [mode, setMode] = useState<AuthMode>("anonymous");
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [m, u] = await Promise.all([
        detect({ token: props.token, repoUrl: props.repoUrl }),
        props.token ? fetchUser(props.token) : Promise.resolve(null),
      ]);
      setMode(m);
      setUser(u);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [props.token, props.repoUrl, detect, fetchUser]);

  useEffect(() => {
    // Defer för att undvika "setState synchronously in effect" — React
    // 19 / eslint-plugin-react-hooks ogillar det. Microtask räcker.
    queueMicrotask(() => { void refresh(); });
  }, [refresh]);

  const value: AuthState = useMemo(() => ({
    mode,
    user,
    loading,
    error,
    shouldRequireLogin: !settings.allowAnonymousRead && mode === "anonymous",
    refresh,
  }), [mode, user, loading, error, settings.allowAnonymousRead, refresh]);

  return <AuthCtx.Provider value={value}>{props.children}</AuthCtx.Provider>;
}

/**
 * Hämta nuvarande auth-state. Returnerar default-state utanför
 * provider (för SSR/tester som inte mountar AuthProvider).
 */
export function useAuthMode(): AuthState {
  const ctx = useContext(AuthCtx);
  if (ctx) return ctx;
  return {
    mode: "anonymous",
    user: null,
    loading: false,
    error: null,
    shouldRequireLogin: false,
    refresh: async () => {},
  };
}

/** Convenience: returnerar true om appen ska vara read-only. */
export function useIsWriteAllowed(): boolean {
  return useAuthMode().mode === "identified-write";
}
