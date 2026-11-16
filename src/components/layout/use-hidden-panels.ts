"use client";

/**
 * Vilka valbara paneler användaren tagit bort på en sida (#1611). Personlig
 * preferens (bara `data.user`, ingen firmastandard) som synkas mellan
 * enheter; uppdateras lokalt direkt så att vyn inte blinkar medan sparandet
 * går (jfr `useFeedbackSeen`). Efter sparandet hämtas preferensen om, så
 * att valet består när sidan visas igen efter navigering (#1612).
 */

import { useMemo, useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { hiddenPanelsPrefKey, parseHiddenPanels } from "@/lib/shared/layout/dock-layout";

/** Dolda paneler på en sida, och hur de döljs och läggs tillbaka. */
export interface HiddenPanels {
  hidden: readonly string[];
  isLoading: boolean;
  /** Användaren tog bort panelen med ×. */
  hide: (id: string) => void;
  /** Lägg tillbaka en dold panel. */
  show: (id: string) => void;
}

/** Utan valbara paneler hämtas ingenting: sidan beter sig som förut. */
export function useHiddenPanels(page: string, closable: readonly string[]): HiddenPanels {
  const key = hiddenPanelsPrefKey(page);
  const stored = trpc.prefs.get.useQuery({ key }, { enabled: closable.length > 0 });
  const utils = trpc.useUtils();
  const save = trpc.prefs.save.useMutation();
  const [local, setLocal] = useState<readonly string[] | null>(null);
  const hidden = useMemo(() => local ?? parseHiddenPanels(stored.data?.user), [local, stored.data]);
  const update = (next: readonly string[]): void => {
    setLocal(next);
    save.mutate({ key, prefs: { hidden: [...next] } }, { onSuccess: () => { void utils.prefs.get.invalidate({ key }); } });
  };
  return {
    hidden,
    isLoading: stored.isLoading,
    hide: (id) => { if (!hidden.includes(id)) update([...hidden, id]); },
    show: (id) => { if (hidden.includes(id)) update(hidden.filter((h) => h !== id)); },
  };
}
