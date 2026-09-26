"use client";

/**
 * Fortnox-bokföringen körs PÅ SERVERN (#1172/#1173, #1176): där finns
 * anslutningen och tokens. I self-hosted körs övriga routrar i webbläsaren mot
 * den lokala storen (vars ledger-port är en no-op), så de här anropen går
 * direkt till serverns tRPC — samma mönster som dokument-nedladdningen.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { flushServerSync } from "@/lib/client/sync/server-sync-flush";
import type { InvoiceId } from "@/lib/shared/schemas/ids";
import { serverTrpcClient as server } from "./server-trpc-client";

const STATUS_KEY = ["server", "ledger.status"] as const;

/** Serverns Fortnox-läge; `undefined` utan server (demo). */
export function useLedgerStatus() {
  const { ledger } = useCapabilities();
  return useQuery({ queryKey: STATUS_KEY, queryFn: () => server().ledger.status.query(), enabled: ledger });
}

/** Starta anslutningen: skicka administratören till Fortnox. */
export function useConnectLedger() {
  return useMutation({
    mutationFn: () => server().ledger.connectUrl.mutate(),
    onSuccess: ({ url }) => { window.location.assign(url); },
  });
}

/** Slutför anslutningen med `code` + `state` från Fortnox. */
export function useCompleteLedgerConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { code: string; state: string }) => server().ledger.completeConnect.mutate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}

/**
 * Bokför fakturan + dess betalningar. Synkar först (servern bokför det den
 * har) och efteråt (verifikaten skrivs på servern och ska synas här).
 */
export function useBookInvoice(invoiceId: InvoiceId, onDone: () => void) {
  return useMutation({
    mutationFn: async () => {
      await flushServerSync();
      return server().ledger.bookInvoice.mutate({ invoiceId });
    },
    onSettled: async () => {
      await flushServerSync().catch(() => undefined);
      onDone();
    },
  });
}
