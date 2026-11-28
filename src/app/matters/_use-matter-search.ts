"use client";

/**
 * Den sammanslagna sökningen i ärendelistan (#1642). Medan man skriver
 * filtreras listan live (sidans `matter.list`); Sök/Enter kör `conflict.check`
 * (som sparar sökningen i historiken, precis som jävskontrollsidan) och hämtar
 * jävsträffarnas ärenden med `matter.list({ ids })`, så att de får samma
 * kolumner som listan. Sammanslagningen bor i `mergeMatterSearch` (ren).
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import type { Column } from "@/components/ui/data-table";
import { labelForMatterRole } from "@/lib/client/labels";
import { useTRPC } from "@/lib/client/trpc";
import { mergeMatterSearch, type MergeConflictHit } from "@/lib/shared/matter-search-merge";
import { asId } from "@/lib/shared/schemas/ids";
import { matterColumns, matterColumnsWithHits, type MatterRow } from "./_matter-columns";

/** `matter.list` tar högst så många id:n (och rader) per anrop. */
const MAX_CONFLICT_MATTERS = 500;

export interface MatterSearch {
  /** Listans rader: sammanslagna efter en sökning, annars listans sida. */
  rows: MatterRow[];
  /** Kolumnerna: med "Träff" efter en sökning. */
  columns: Column<MatterRow>[];
  /** Antal jävsträffar efter en sökning; `null` före (eller efter rensning). */
  matchCount: number | null;
  /** Kör jävskontrollen på termen (Sök/Enter). Tom term gör inget. */
  run: (term: string) => void;
  /** Glöm sökningen (sökrutan ändrades eller rensades). */
  reset: () => void;
  searching: boolean;
  error: { message: string } | null;
}

type ConflictCheckData = { searchTerm: string; matchCount: number; results: MergeConflictHit[] };

/** Jävsträffarnas ärenden (unika, bäst först) — högst det `matter.list` tar. */
function conflictMatterIds(data: ConflictCheckData | undefined): string[] {
  return [...new Set((data?.results ?? []).map((h) => h.matterId))].slice(0, MAX_CONFLICT_MATTERS);
}

/** Listans rader: listans sida före en sökning, annars den sammanslagna listan. */
function searchRows(data: ConflictCheckData | undefined, conflictMatters: MatterRow[] | undefined, listMatters: MatterRow[]): MatterRow[] {
  if (!data) return listMatters;
  return mergeMatterSearch<MatterRow>({
    term: data.searchTerm,
    conflictHits: data.results,
    conflictMatters: conflictMatters ?? [],
    listMatters,
    roleLabel: labelForMatterRole,
  });
}

export function useMatterSearch(listMatters: MatterRow[] | undefined): MatterSearch {
  const t = useTRPC();
  const check = useMutation(t.conflict.check.mutationOptions());
  const ids = conflictMatterIds(check.data);
  const conflictMatters = useQuery(t.matter.list.queryOptions(
    { ids: ids.map((id) => asId<"MatterId">(id)), page: 1, pageSize: Math.max(ids.length, 1) },
    { enabled: ids.length > 0 },
  ));
  const searched = check.data !== undefined;
  return {
    rows: searchRows(check.data, ids.length > 0 ? conflictMatters.data?.matters : [], listMatters ?? []),
    columns: searched ? matterColumnsWithHits : matterColumns,
    matchCount: check.data?.matchCount ?? null,
    run: (term) => {
      const searchTerm = term.trim();
      if (searchTerm) check.mutate({ searchTerm, searchType: "both" });
    },
    reset: () => check.reset(),
    searching: check.isPending,
    error: check.error,
  };
}
