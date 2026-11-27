"use client";

/**
 * Personens förvalda vy i rutan Stapeldiagram (#2111). Personlig preferens
 * under `chart.time` (bara `data.user`, ingen byråstandard) som synkas mellan
 * enheter, som `useHiddenPanels`. Ett byte syns direkt och sparas; efter
 * sparandet läses nyckeln om, så att valet består efter navigering.
 */

import { useState } from "react";
import { trpc } from "@/lib/client/trpc";
import { parseTimeChartView, TIME_CHART_PREF_KEY, type TimeChartView } from "./time-chart-labels";

/** Vyn som visas och hur den byts. Till dess inställningen lästs: Vecka. */
export function useTimeChartView(): [TimeChartView, (view: TimeChartView) => void] {
  const key = TIME_CHART_PREF_KEY;
  const stored = trpc.prefs.get.useQuery({ key });
  const utils = trpc.useUtils();
  const save = trpc.prefs.save.useMutation();
  const [local, setLocal] = useState<TimeChartView | null>(null);
  const view = local ?? parseTimeChartView(stored.data?.user);
  const choose = (next: TimeChartView): void => {
    setLocal(next);
    save.mutate({ key, prefs: { view: next } }, { onSuccess: () => { void utils.prefs.get.invalidate({ key }); } });
  };
  return [view, choose];
}
