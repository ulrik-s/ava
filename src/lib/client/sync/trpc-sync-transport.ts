/**
 * `TrpcSyncTransport` (#sync-bridge, ADR 0017) — klientens `SyncTransport`-impl
 * som `ReconcileEngine` (#414) / `CachingSyncDataStore` (#415) pratar genom.
 * Översätter pull/push → tRPC-anrop mot server-runtimens `sync`-router
 * (#410/#411) via en `TRPCClient<AppRouter>` (httpBatchLink, samma transport som
 * `HttpBackendRuntime`).
 *
 * Stänger bryggan: offline-kön reconcile:ar nu mot den auktoritativa Postgres-
 * servern i st.f. en fejk-transport.
 */

import type { TRPCClient } from "@trpc/client";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { PullResult, PushResult, SyncTransport } from "@/lib/server/data-store/in-memory/sync-transport";
import type { AppRouter } from "@/lib/server/routers/_app";

export class TrpcSyncTransport implements SyncTransport {
  constructor(private readonly client: TRPCClient<AppRouter>) {}

  pull(sinceCursor: number): Promise<PullResult> {
    return this.client.sync.pull.query({ sinceCursor }) as Promise<PullResult>;
  }

  push(mutation: QueuedMutation): Promise<PushResult> {
    return this.client.sync.push.mutate(mutation) as Promise<PushResult>;
  }
}
