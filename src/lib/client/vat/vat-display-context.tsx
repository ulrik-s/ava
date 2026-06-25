"use client";

/**
 * Globalt visningsläge för moms (#781): ska belopp i UIt visas **inkl.** eller
 * **exkl.** moms? Ett app-övergripande, persisterat val — klick på valfritt
 * belopp (via `<Money>`) växlar hela appen, och en global indikator visar
 * aktuellt läge. Lagringen av belopp påverkas inte; detta är ren visning.
 *
 * Standardläge = "incl" (visa bruttot/det klienten betalar, som tidigare) —
 * växlingen är då rent additiv. Lagras i localStorage och läses via
 * `useSyncExternalStore` → SSR/export-säkert utan hydration-mismatch eller
 * setState-i-effect.
 */

import { createContext, useCallback, useContext, useSyncExternalStore, type ReactNode } from "react";

export type VatMode = "excl" | "incl";

const STORAGE_KEY = "ava.vatDisplayMode";

const listeners = new Set<() => void>();
function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
function getSnapshot(): VatMode {
  return window.localStorage.getItem(STORAGE_KEY) === "excl" ? "excl" : "incl";
}
function getServerSnapshot(): VatMode {
  return "incl";
}

interface VatDisplayValue {
  mode: VatMode;
  toggle: () => void;
}

const VatDisplayContext = createContext<VatDisplayValue>({ mode: "incl", toggle: () => {} });

export function VatDisplayProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const toggle = useCallback(() => {
    const next: VatMode = getSnapshot() === "excl" ? "incl" : "excl";
    window.localStorage.setItem(STORAGE_KEY, next);
    for (const l of listeners) l();
  }, []);
  return <VatDisplayContext.Provider value={{ mode, toggle }}>{children}</VatDisplayContext.Provider>;
}

export function useVatDisplay(): VatDisplayValue {
  return useContext(VatDisplayContext);
}
