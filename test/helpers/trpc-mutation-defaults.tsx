/**
 * Visar att `TRPCProvider` får just den QueryClient som testet ger (#1926):
 * `mutationOptions()` läser mutationsstandarder ur providerns QueryClient, så
 * standarder som sätts på testets klient når bara fram om de är samma.
 */
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { vi } from "vitest-compat";
import { useTRPC } from "@/lib/client/trpc";

/** En sond: `Probe` kör `prefs.clear` en gång, `onSuccess` är standarden på `qc`. */
export function mutationDefaultsProbe(qc: QueryClient) {
  const onSuccess = vi.fn();
  qc.setMutationDefaults([["prefs", "clear"]], { onSuccess });
  function Probe() {
    const clear = useMutation(useTRPC().prefs.clear.mutationOptions());
    const { mutate } = clear;
    useEffect(() => { mutate({ key: "sond" }); }, [mutate]);
    return null;
  }
  return { onSuccess, Probe };
}
