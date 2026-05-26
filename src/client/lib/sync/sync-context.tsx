"use client";

/**
 * `SyncContext` — gör sync-state och `syncNow` tillgängligt för flera
 * komponenter (status-pillen + diagnostics-panelen i /settings) utan
 * att dubbla sync-loopen.
 *
 * Ägaren av loopen är `SyncProviderRoot` som mountas en gång i
 * DemoBootstrap. Konsumenter använder `useSyncContext()`.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { SyncProvider, SyncState } from "./use-auto-sync";
import { useAutoSync } from "./use-auto-sync";
import { useAuthMode } from "@/client/lib/auth/use-auth-mode";

export interface SyncContextValue {
  state: SyncState;
  syncNow: () => Promise<void>;
  notifyChange: () => void;
  providerKind: "fsa" | null;
  /** Tidigare även "tauri" — borttagen, web-only nu. */
  /** Senaste error-meddelandet, persisteras tills syncen lyckas. */
  lastError: string | null;
  /** Sync aktiv = både provider OK och auth tillåter write. False i
   *  demo (anonym) eller om FSA-handle saknas. UI:n disable:ar då
   *  "Synka nu"-knappen och förklarar varför. */
  enabled: boolean;
}

const SyncCtx = createContext<SyncContextValue | null>(null);

interface RootProps {
  token: string;
  pickProvider: (token: string) => Promise<{ provider: SyncProvider; kind: "fsa" } | null>;
  children: ReactNode;
}

/**
 * Mountas en gång (i DemoBootstrap). Äger sync-loopen + state.
 */
export function SyncProviderRoot({ token, pickProvider, children }: RootProps) {
  const [picked, setPicked] = useState<{ provider: SyncProvider; kind: "fsa" } | null>(null);
  const auth = useAuthMode();
  const writeAllowed = auth.mode === "identified-write";

  useEffect(() => {
    let cancelled = false;
    const pick = async () => {
      const p = await pickProvider(token);
      if (!cancelled) setPicked(p);
    };
    void pick();
    // Self-hosted/OPFS: working copy + handle blir redo ASYNKRONT efter
    // mount (clone). Plocka om provider:n när repo:t signalerar "ready"
    // (annars sätts provider till null en gång och sync startar aldrig).
    const onReady = () => { void pick(); };
    if (typeof window !== "undefined") window.addEventListener("ava:repo-ready", onReady);
    return () => {
      cancelled = true;
      if (typeof window !== "undefined") window.removeEventListener("ava:repo-ready", onReady);
    };
  }, [token, pickProvider]);

  const { state, syncNow, notifyChange } = useAutoSync({
    provider: picked?.provider ?? null,
    enabled: writeAllowed && picked !== null,
  });

  // Persistera senaste fel även när vi går vidare till andra state:s
  const [lastError, setLastError] = useState<string | null>(null);
  useEffect(() => {
    queueMicrotask(() => {
      if (state.kind === "error") setLastError(state.message);
      else if (state.kind === "synced") setLastError(null);
    });
  }, [state]);

  // Lyssna på data-ändringar från DemoDataStore → debounced push
  useEffect(() => {
    if (!writeAllowed || !picked) return;
    const handler = () => notifyChange();
    window.addEventListener("ava:data-changed", handler);
    return () => window.removeEventListener("ava:data-changed", handler);
  }, [writeAllowed, picked, notifyChange]);

  const value: SyncContextValue = {
    state,
    syncNow,
    notifyChange,
    providerKind: picked?.kind ?? null,
    lastError,
    enabled: writeAllowed && picked !== null,
  };

  return <SyncCtx.Provider value={value}>{children}</SyncCtx.Provider>;
}

/**
 * Returnerar nuvarande sync-state + actions. Utanför provider:n
 * returneras en no-op state (för SSR/test).
 */
export function useSyncContext(): SyncContextValue {
  const ctx = useContext(SyncCtx);
  if (ctx) return ctx;
  return {
    state: { kind: "idle" },
    syncNow: async () => {},
    notifyChange: () => {},
    providerKind: null,
    lastError: null,
    enabled: false,
  };
}
