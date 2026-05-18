/**
 * `useDemoRuntime` — React-hook som synkar UI-state med `DemoRuntime`.
 *
 * Designval (Single responsibility):
 *   - Hooken gör BARA: håller runtime-instans, exponerar state, försöker
 *     `restoreFromCache()` vid mount, rerendar när status ändras.
 *   - Den känner inte till UI-komponenter, routing eller styling.
 *
 * Designval (DI):
 *   - `runtimeFactory` injiceras → tester använder en fake-runtime,
 *     produktion använder
 *     `() => DemoRuntime.create({ cloneFn: cloneFromGithub(), persistence: ... })`.
 *
 * Designval (DRY):
 *   - Återanvänder `DemoRuntime.entities()` och `status()` direkt.
 *     Lägger ingen egen state-modell ovanpå.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DemoRuntime, DemoStatus } from "@/server/local-first/demo-runtime";

export interface DemoRuntimeState {
  status: DemoStatus;
  error: Error | null;
  entities: Record<string, unknown[]>;
  loadDemo: (url: string) => Promise<void>;
  /**
   * `true` om data hydratiserades från persistens-cache vid mount —
   * UI:t kan visa "Cachat från tidigare session" och spara nät-roundtripen.
   */
  fromCache: boolean;
}

export function useDemoRuntime(runtimeFactory: () => DemoRuntime): DemoRuntimeState {
  // Lazy initiation via useState — React-idiomatiskt sätt att köra
  // factory:n exakt en gång per komponent-instans.
  const [runtime] = useState<DemoRuntime>(runtimeFactory);

  const [status, setStatus] = useState<DemoStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [entities, setEntities] = useState<Record<string, unknown[]>>({});
  const [fromCache, setFromCache] = useState(false);

  // Vid mount: försök ladda från persistens-cache. Om det lyckas
  // slipper vi en HTTPS-roundtrip.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const restored = await runtime.restoreFromCache();
        if (cancelled) return;
        if (restored) {
          setEntities(collectEntities(runtime));
          setStatus("loaded");
          setFromCache(true);
        }
      } catch {
        // Cache-fel är inte kritiska — användaren kan ladda om manuellt
      }
    })();
    return () => { cancelled = true; };
  }, [runtime]);

  const loadDemo = useCallback(async (url: string) => {
    setStatus("loading");
    setError(null);
    setFromCache(false);
    try {
      await runtime.loadDemo(url);
      setEntities(collectEntities(runtime));
      setStatus("loaded");
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, [runtime]);

  return useMemo(
    () => ({ status, error, entities, loadDemo, fromCache }),
    [status, error, entities, loadDemo, fromCache],
  );
}

/** Hämta alla entiteter från runtime som ett platt objekt. */
function collectEntities(rt: DemoRuntime): Record<string, unknown[]> {
  const result: Record<string, unknown[]> = {};
  for (const entity of ["matter", "contact", "user"] as const) {
    const coll =
      entity === "matter" ? rt.matters() :
      entity === "contact" ? rt.contacts() :
      rt.users();
    result[entity] = coll.list();
  }
  return result;
}
