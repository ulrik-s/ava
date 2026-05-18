/**
 * `useDemoRuntime` — React-hook som synkar UI-state med `DemoRuntime`.
 *
 * Designval (Single responsibility):
 *   - Hooken gör BARA tre saker: håller runtime-instans, exponerar
 *     state, och rerendar när status ändras. Den känner inte till
 *     UI-komponenter, routing eller styling.
 *
 * Designval (DI):
 *   - `runtimeFactory` injiceras → tester använder en fake-runtime,
 *     produktion använder `() => DemoRuntime.create({ cloneFn: cloneFromGithub() })`.
 *
 * Designval (DRY):
 *   - Återanvänder `DemoRuntime.entities()` och `status()` direkt.
 *     Lägger ingen egen state-modell ovanpå.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { DemoRuntime, DemoStatus } from "@/server/local-first/demo-runtime";

export interface DemoRuntimeState {
  status: DemoStatus;
  error: Error | null;
  entities: Record<string, unknown[]>;
  loadDemo: (url: string) => Promise<void>;
}

export function useDemoRuntime(runtimeFactory: () => DemoRuntime): DemoRuntimeState {
  // useMemo med tom dep-array gör att factory bara körs en gång per
  // komponent-instans. Vi använder useRef för att garantera identitet
  // över rerender:s utan att kompilatorn varnar för useMemo-deps.
  const runtimeRef = useRef<DemoRuntime | null>(null);
  if (runtimeRef.current === null) {
    runtimeRef.current = runtimeFactory();
  }
  const runtime = runtimeRef.current;

  const [status, setStatus] = useState<DemoStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [entities, setEntities] = useState<Record<string, unknown[]>>({});

  const loadDemo = useCallback(async (url: string) => {
    setStatus("loading");
    setError(null);
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

  // Avregistrerings-frihet vid SSR: värdena bygger på status så de
  // uppdateras vid varje setState.
  return useMemo(
    () => ({ status, error, entities, loadDemo }),
    [status, error, entities, loadDemo],
  );
}

/** Hämta alla entiteter från runtime som ett platt objekt. */
function collectEntities(rt: DemoRuntime): Record<string, unknown[]> {
  // DemoRuntime.entities() ärvs internt — vi anropar via getters
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
