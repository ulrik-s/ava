"use client";

/**
 * `useCapabilities` (ADR 0027) — vad den aktiva runtimen kan, för UI-gating.
 *
 * Två lager:
 *   - Synkron baslinje: `capabilitiesForTier(firma-config.tier)` — alltid
 *     tillgänglig (även utan provider, t.ex. i enhetstester), aldrig blockerande.
 *   - `CapabilitiesProvider` (server-first): **probar** den deployade servern
 *     (`system.capabilities`) vid mount och förfinar baslinjen med serverns
 *     faktiska förmågor (t.ex. `llm:false` om ingen ollama). Probe-miss → behåll
 *     baslinjen. Demon probar inte (ingen server).
 *
 * UI:t gate:ar på dessa flaggor — ALDRIG på `if (isDemo)`.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { capabilitiesForTier, type Capabilities } from "@/lib/shared/capabilities";
import { probeCapabilities } from "./probe-capabilities";

const CapabilitiesContext = createContext<Capabilities | null>(null);

export function CapabilitiesProvider({ children }: { children: ReactNode }) {
  const [caps, setCaps] = useState<Capabilities>(() => capabilitiesForTier(loadFirmaConfig().tier));
  useEffect(() => {
    if (loadFirmaConfig().tier !== "self-hosted") return; // demon: ingen server att proba
    let cancelled = false;
    void probeCapabilities().then((probed) => { if (!cancelled && probed) setCaps(probed); });
    return () => { cancelled = true; };
  }, []);
  return <CapabilitiesContext.Provider value={caps}>{children}</CapabilitiesContext.Provider>;
}

/** Förmågorna för den aktiva runtimen. Utanför provider → tier-baslinjen. */
export function useCapabilities(): Capabilities {
  const ctx = useContext(CapabilitiesContext);
  return useMemo(() => ctx ?? capabilitiesForTier(loadFirmaConfig().tier), [ctx]);
}
