/**
 * `useDemoSeed` — React-hook som laddar en `DemoSource` direkt från GH Pages
 * (ADR 0016, #420). Ersätter `useDemoRuntime` (MemFs/DemoRuntime borttagen).
 *
 * Designval (Single responsibility): hooken håller bara status/error/source
 * och exponerar `loadDemo(url)`. Ingen UI, routing eller styling.
 *
 * Designval (DI): `loader` injiceras → tester använder en fake; produktion
 * använder `loadDemoSeed`.
 */

import { useCallback, useMemo, useState } from "react";
import type { DemoSource } from "@/lib/shared/demo-source";

export type DemoSeedStatus = "idle" | "loading" | "loaded" | "error";

export interface DemoSeedState {
  status: DemoSeedStatus;
  error: Error | null;
  source: DemoSource;
  loadDemo: (repo: string) => Promise<void>;
}

export function useDemoSeed(loader: (repo: string) => Promise<DemoSource>): DemoSeedState {
  const [status, setStatus] = useState<DemoSeedStatus>("idle");
  const [error, setError] = useState<Error | null>(null);
  const [source, setSource] = useState<DemoSource>({});

  const loadDemo = useCallback(async (repo: string) => {
    setStatus("loading");
    setError(null);
    try {
      const loaded = await loader(repo);
      setSource(loaded);
      setStatus("loaded");
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setStatus("error");
      throw err;
    }
  }, [loader]);

  return useMemo(
    () => ({ status, error, source, loadDemo }),
    [status, error, source, loadDemo],
  );
}
