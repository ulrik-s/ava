"use client";

/**
 * `useCapabilities` (ADR 0027 / #639) — vad den aktiva runtimen kan, för
 * UI-gating. Slice 1: härleds ur `firma-config.tier`. Nästa slice byter detta
 * mot en server-annonserad `system.capabilities`-probe — konsumenterna
 * (`useCapabilities()`-anropen) ändras inte, bara resolvern här.
 */

import { useMemo } from "react";
import { loadFirmaConfig } from "@/lib/client/firma/firma-config";
import { capabilitiesForTier, type Capabilities } from "@/lib/shared/capabilities";

export function useCapabilities(): Capabilities {
  return useMemo(() => capabilitiesForTier(loadFirmaConfig().tier), []);
}
