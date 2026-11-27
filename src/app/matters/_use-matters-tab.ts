"use client";

/**
 * Ärendelistans flik (#1968) står i adressen: `/matters/` är Mitt aktskåp och
 * `/matters/?flik=alla` är Alla ärenden på byrån. Next navigerar mjukt till
 * samma sida utan att montera om den, så fliken kan inte ligga i `useState`:
 * sidomenyns länk till `/matters` ska alltid ge Mitt aktskåp.
 */

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Ärendelistans flikar: egna aktiva ärenden eller hela byrån. */
export type MattersTab = "mine" | "all";

/** Adressen för varje flik (`trailingSlash: true`). */
export const MATTERS_TAB_HREF: Readonly<Record<MattersTab, string>> = {
  mine: "/matters/",
  all: "/matters/?flik=alla",
};

/** Fliken ur `flik`-parametern: `alla` är hela byrån, allt annat Mitt aktskåp. */
export function tabFromParam(value: string | null): MattersTab {
  return value === "alla" ? "all" : "mine";
}

/** Vald flik och bytet till en annan (utan nytt steg i historiken). */
export interface MattersTabState {
  tab: MattersTab;
  select: (tab: MattersTab) => void;
}

/** Läser fliken ur adressen och byter den med `router.replace`. */
export function useMattersTab(): MattersTabState {
  const params = useSearchParams();
  const router = useRouter();
  return {
    tab: tabFromParam(params.get("flik")),
    select: (tab) => router.replace(MATTERS_TAB_HREF[tab]),
  };
}

/**
 * Sidan i listan, som börjar om på 1 när fliken byts, också när `flik` ändras
 * i adressen utan klick (t.ex. via sidomenyn). Sidan hör till fliken den
 * valdes i, så en annan flik läser alltid sidan 1.
 */
export function usePageForTab(tab: MattersTab): [number, (page: number) => void] {
  const [state, setState] = useState({ tab, page: 1 });
  const page = state.tab === tab ? state.page : 1;
  return [page, (next) => setState({ tab, page: next })];
}
