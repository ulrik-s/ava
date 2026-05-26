/**
 * `useMediaQuery` — React-hook som synkar mot `window.matchMedia()`.
 *
 * Användning:
 *   const isCompact = useMediaQuery("(max-width: 768px)");
 *   const hasHover  = useMediaQuery("(hover: hover)");
 *
 * Designval (Single responsibility):
 *   - Bara medium-query-state. Inga UI-beslut här.
 *
 * Designval (SSR-säkerhet):
 *   - `window` finns inte vid SSR. `useSyncExternalStore` ger ett
 *     server-snapshot (defaultValue) och hydratiserar säkert på klient.
 *
 * Designval (React 19):
 *   - `useSyncExternalStore` är det rekommenderade mönstret för externa
 *     stores — undviker cascading-renders som synkron setState i effect
 *     orsakar.
 */

"use client";

import { useSyncExternalStore } from "react";

type MatchMediaFn = (q: string) => MediaQueryList;

function getMatchMedia(): MatchMediaFn | undefined {
  if (typeof window === "undefined") return undefined;
  return (globalThis as { matchMedia?: MatchMediaFn }).matchMedia;
}

export function useMediaQuery(query: string, defaultValue = false): boolean {
  const subscribe = (onChange: () => void): (() => void) => {
    const mm = getMatchMedia();
    if (!mm) return () => {};
    const mql = mm(query);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  };

  const getSnapshot = (): boolean => {
    const mm = getMatchMedia();
    return mm ? mm(query).matches : defaultValue;
  };

  const getServerSnapshot = (): boolean => defaultValue;

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
