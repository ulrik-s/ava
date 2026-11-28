"use client";

/**
 * `useBillingQueryUtils` (#1929, ADR 0041) — de smala invaliderings-sömmarna
 * (`BillingSideEffectUtils`, `DocumentListUtils`, `UnbilledWorkUtils`, `DocUtils`)
 * byggda på den nya bindningen: `queryClient.invalidateQueries(t.x.queryFilter(in))`
 * och `refetchQueries` med samma filter.
 *
 * Hjälpfunktionerna (`invalidateUnbilledWork`, `generateKrDoc`, `recordDocument` …)
 * tar redan en smal söm, inte hela `useUtils()`. Komponenter som flyttats till
 * `useTRPC()` skickar in den här i stället, så att reglerna står på ett ställe
 * och båda bindningarna kan använda dem under flytten.
 */

import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { inferRouterInputs } from "@trpc/server";
import { useMemo } from "react";
import type { BillingSideEffectUtils, DocumentListUtils, UnbilledWorkUtils } from "@/lib/client/billing/invalidate-billing-side-effects";
import type { DocUtils } from "@/lib/client/kostnadsrakning/generate-faktura-doc";
import { useTRPC } from "@/lib/client/trpc";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { MatterId } from "@/lib/shared/schemas/ids";

/** Options-proxyn ur `useTRPC()`. */
type TrpcProxy = ReturnType<typeof useTRPC>;
type DocumentInputs = inferRouterInputs<AppRouter>["document"];

/** Alla smala invaliderings-sömmar i ett objekt. */
export type BillingQueryUtils = BillingSideEffectUtils & DocumentListUtils & UnbilledWorkUtils & DocUtils;

/** Sömmarna över en given proxy och QueryClient (testbar utan React). */
export function billingQueryUtils(t: TrpcProxy, queryClient: QueryClient): BillingQueryUtils {
  return {
    serviceNote: { list: { invalidate: () => queryClient.invalidateQueries(t.serviceNote.list.queryFilter()) } },
    watchlist: { list: { invalidate: () => queryClient.invalidateQueries(t.watchlist.list.queryFilter()) } },
    billingRun: {
      proposal: { invalidate: (input?: { matterId: MatterId }) => queryClient.invalidateQueries(t.billingRun.proposal.queryFilter(input)) },
    },
    document: {
      list: { invalidate: (filter?: DocumentInputs["list"]) => queryClient.invalidateQueries(t.document.list.queryFilter(filter)) },
      tree: {
        invalidate: (filter?: DocumentInputs["tree"]) => queryClient.invalidateQueries(t.document.tree.queryFilter(filter)),
        refetch: (filter?: DocumentInputs["tree"]) => queryClient.refetchQueries(t.document.tree.queryFilter(filter)),
      },
    },
  };
}

/** Sömmarna för komponenter som använder `useTRPC()`. */
export function useBillingQueryUtils(): BillingQueryUtils {
  const t = useTRPC();
  const queryClient = useQueryClient();
  return useMemo(() => billingQueryUtils(t, queryClient), [t, queryClient]);
}
