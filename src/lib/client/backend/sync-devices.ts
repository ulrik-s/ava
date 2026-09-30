"use client";

/**
 * Synkläget per enhet (#1267) — adminens översikt. Läses AV SERVERN: den
 * lokala storen vet bara om den egna webbläsaren. Döljs i demo (ingen server)
 * och för den som inte är admin.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCapabilities } from "@/lib/client/capabilities/use-capabilities";
import { trpc } from "@/lib/client/trpc";
import { serverTrpcClient as server } from "./server-trpc-client";

const DEVICES_KEY = ["server", "sync.devices"] as const;

/** Visas översikten här? (server + admin) */
export function useCanSeeSyncDevices(): boolean {
  const { sync } = useCapabilities();
  const me = trpc.user.current.useQuery(undefined, { enabled: sync });
  return sync && me.data?.role === "ADMIN";
}

/** Byråns enheter; `undefined` när översikten inte visas. */
export function useSyncDevices() {
  const enabled = useCanSeeSyncDevices();
  return useQuery({ queryKey: DEVICES_KEY, queryFn: () => server().sync.devices.query(), enabled });
}

/** Glöm en utrangerad enhet. */
export function useForgetSyncDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deviceId: string) => server().sync.forgetDevice.mutate({ deviceId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: DEVICES_KEY }),
  });
}
