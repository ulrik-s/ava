"use client";

/**
 * `DemoModeBanner` — tunn upplysning högst upp när appen körs i
 * publik demo-mode (tier=demo). Ändringar man gör (skapa ärende,
 * avbryta plan, etc.) gäller bara i den här fliken — de persisteras
 * varken till gh-pages-repot eller en lokal kopia.
 *
 * Visas en gång per session; användaren kan stänga den manuellt.
 */

import { Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";

const STORAGE_KEY = "ava.demoBannerDismissed";

export function DemoModeBanner() {
  // Hydration-safe: gör beslut efter mount, INTE i SSR (gh-pages saknar
  // localStorage vid render, dessutom skulle tier:n läsas innan
  // firmaConfig migrerats för defaults-on-host).
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cfg = loadFirmaConfig();
    if (cfg.tier !== "demo") return;
    const dismissed = sessionStorage.getItem(STORAGE_KEY) === "1";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!dismissed) setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = (): void => {
    if (typeof window !== "undefined") sessionStorage.setItem(STORAGE_KEY, "1");
    setShow(false);
  };

  const reset = async (): Promise<void> => {
    if (typeof window === "undefined") return;
    if (!window.confirm("Återställa demon? All lokal demo-data och dina lokala ändringar i den här webbläsaren raderas, och färsk demo-data laddas.")) return;
    try {
      const { resetDemoCompletely } = await import("@/lib/client/demo/reset-demo");
      await resetDemoCompletely();
    } catch { /* best-effort — reload laddar ändå färsk seed */ }
    window.location.reload();
  };

  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-xs px-4 py-2 flex items-center gap-2">
      <Info size={14} className="shrink-0" />
      <span className="flex-1">
        <strong>Demo-läge</strong> — du kör mot publik data från GitHub Pages.
        Dina ändringar sparas lokalt i den här webbläsaren (de delas inte och syns inte för andra).
        Vill du dela data på riktigt, kör mot en egen self-hosted-stack.
      </span>
      <button
        type="button"
        onClick={() => void reset()}
        className="shrink-0 underline hover:no-underline whitespace-nowrap"
      >
        Återställ demo
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Stäng demo-banner"
        className="p-0.5 rounded hover:bg-amber-100"
      >
        <X size={14} />
      </button>
    </div>
  );
}
