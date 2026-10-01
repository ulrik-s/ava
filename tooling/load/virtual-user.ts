/**
 * En virtuell användare i lasttestet (#1366) — byggd som webbläsarens
 * self-hosted-klient, men i en bun-process:
 *
 *   - `createServerFirstStore` (lokal store + procedurkö + reconcile-motor)
 *     mot den riktiga servern över HTTP (`TrpcSyncTransport`),
 *   - routrarna körs i klienten (`GitBackendRuntime` med `recordProcedure`),
 *     så en mutation går exakt som i webbläsaren: lokalt först, sedan kön,
 *   - `SyncScheduler` synkar strax efter varje ändring (debounce), som appen,
 *   - en egen tRPC-klient direkt mot servern för det som bara servern gör
 *     (sök, nedladdning, uppladdning, enhetsrapport).
 *
 * Lagringen är i minnet (ingen IndexedDB i bun): `InMemoryPersistence` och
 * `InMemoryMutationQueuePersistence`, samma som synksimuleringen (#1268).
 * Nätet styrs med `online` — av betyder att `fetch` kastar, som offline.
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import superjson from "superjson";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { InMemoryRejectedChangesPersistence, RejectedChanges } from "@/lib/client/backend/rejected-changes";
import { createServerFirstStore } from "@/lib/client/backend/server-first-store";
import { buildDeviceReport } from "@/lib/client/backend/sync-device-report";
import { toLinkFetch } from "@/lib/client/link-fetch";
import { SyncScheduler } from "@/lib/client/sync/sync-scheduler";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import { InMemoryMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";
import type { AppRouter } from "@/lib/server/routers/_app";
import { asId } from "@/lib/shared/schemas/ids";
import { syncErrorMessage } from "@/lib/shared/sync/sync-error";
import { uuidv7 } from "@/lib/shared/uuid";
import type { OrgTarget } from "./config";
import { timedFetch, type FetchFn } from "./http-metrics";
import type { LatencyRecorder } from "./stats";

/** Användaren bakom en virtuell klient — samma id i servern och i klientens principal. */
export interface LoadUser {
  id: string;
  email: string;
  name: string;
  org: OrgTarget;
}

/** Den lokala storens källnycklar lasttestet läser. */
export type SourceKey = "timeEntries" | "expenses" | "contacts" | "invoices" | "matters" | "serviceNotes" | "documents" | "billingRuns";

const USER_AGENT = "Mozilla/5.0 (Macintosh) AVA-lasttest/1.0";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** tRPC-klient direkt mot servern, genom den tidtagande `fetch`. */
export function serverClient(org: OrgTarget, fetchFn: FetchFn): TRPCClient<AppRouter> {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${org.serverUrl}/api/trpc`, transformer: superjson, fetch: toLinkFetch(fetchFn) })],
  });
}

export class VirtualUser {
  online = true;
  store!: CachingSyncDataStore;
  /** Appens tRPC-klient: routrarna i klienten, mutationer via kön. */
  api!: TRPCClient<AppRouter>;
  /** Direkt mot servern (sök, nedladdning, uppladdning, enhetsrapport). */
  server!: TRPCClient<AppRouter>;
  readonly rejected = new RejectedChanges(new InMemoryRejectedChangesPersistence());
  private scheduler!: SyncScheduler;
  private readonly deviceId = uuidv7();
  private lastError: string | null = null;
  /** Pågående reconcile — `syncNow` väntar in en synk som redan var igång. */
  private reconciling = 0;
  private reporting = 0;
  private readonly fetchFn: FetchFn;

  constructor(readonly index: number, readonly user: LoadUser, private readonly recorder: LatencyRecorder) {
    this.fetchFn = timedFetch({ recorder, email: user.email, isOnline: () => this.online });
  }

  async boot(): Promise<void> {
    this.store = await createServerFirstStore({
      baseUrl: this.user.org.serverUrl,
      fetch: this.fetchFn,
      persistence: new InMemoryPersistence(),
      queuePersistence: new InMemoryMutationQueuePersistence(),
      skipInitialReconcile: true,
      rejected: { changes: this.rejected, persistence: new InMemoryRejectedChangesPersistence() },
    });
    const store = this.store;
    this.api = createTRPCClient<AppRouter>({
      links: [new GitBackendRuntime({
        dataStore: store.store,
        authProvider: new GitAuthProvider({
          id: asId<"UserId">(this.user.id), email: this.user.email, name: this.user.name, role: "LAWYER",
          organizationId: asId<"OrganizationId">(this.user.org.organizationId),
        }),
        recordProcedure: (call, exec) => store.runQueuedProcedure(call, exec),
      }).createLink()],
    });
    this.server = serverClient(this.user.org, this.fetchFn);
    this.scheduler = new SyncScheduler({
      reconcile: () => this.timedReconcile(),
      pendingCount: () => store.pendingCount(),
      isOnline: () => this.online,
      onStatus: (status) => { this.lastError = status.error ?? null; },
    });
    // Synk-efter-spara, som appen (`use-auto-sync`): varje lokal ändring schemalägger en synk.
    store.onLocalChange(() => this.scheduler.notifyChange());
  }

  /**
   * En synkrunda som appens (`server-first-sync.tsx`): reconcile, tidtagen som en
   * helhet (pull + uppspelning av kön), och sedan enhetsrapporten (#1267) —
   * oavsett utfall, med felet som stoppade synken (#1353).
   */
  private async timedReconcile(): ReturnType<CachingSyncDataStore["reconcile"]> {
    const start = performance.now();
    let lastError: string | null = null;
    this.reconciling++;
    try {
      const result = await this.store.reconcile();
      this.recorder.record({ op: "client.reconcile", ms: performance.now() - start, status: 200 });
      if (result.blocked) lastError = syncErrorMessage(result.blocked.error);
      return result;
    } catch (err) {
      this.recorder.record({ op: "client.reconcile", ms: performance.now() - start, status: 0, error: "RECONCILE_FAILED" });
      lastError = syncErrorMessage(err);
      throw err;
    } finally {
      this.reconciling--;
      void this.report(lastError);
    }
  }

  /** Enhetsrapporten; bäst-möjligt som i appen (ett fel fäller aldrig synken). */
  private async report(lastError: string | null): Promise<void> {
    if (!this.online) return;
    this.reporting++;
    try {
      await this.server.sync.reportDevice.mutate(buildDeviceReport(this.store, USER_AGENT, lastError, this.deviceId));
    } catch {
      // Nästa synk rapporterar igen.
    } finally {
      this.reporting--;
    }
  }

  /**
   * Synka nu. Pågår redan en synk (t.ex. den debouncade efter en ändring) kör
   * schemaläggaren en runda till efteråt — och här väntas båda in, liksom rapporten.
   */
  async syncNow(): Promise<void> {
    await this.scheduler.syncNow();
    while (this.reconciling > 0 || this.reporting > 0) await sleep(20);
  }

  /** Synka tills kön är tom; returnerar hur lång tid det tog (ms), eller kastar vid timeout. */
  async drain(timeoutMs: number): Promise<number> {
    const start = performance.now();
    while (this.store.pendingCount() > 0) {
      if (performance.now() - start > timeoutMs) {
        throw new Error(`${this.user.email}: ${this.store.pendingCount()} ändringar kvar i kön efter ${timeoutMs} ms (${this.lastError ?? "inget fel"})`);
      }
      await this.syncNow();
      if (this.store.pendingCount() > 0) await sleep(200);
    }
    return performance.now() - start;
  }

  /** Lokala rader (inte borttagna) för en entitet. */
  rows(key: SourceKey): Array<Record<string, unknown>> {
    const source = this.store.store.currentSource as Partial<Record<SourceKey, Array<Record<string, unknown>>>>;
    return (source[key] ?? []).filter((r) => r.deletedAt == null);
  }

  /** Senaste synkfelet (för rapporten). */
  get syncError(): string | null {
    return this.lastError;
  }

  /** Beskriv ett fel kort, för rapporten. */
  static describe(err: unknown): string {
    return syncErrorMessage(err).slice(0, 200);
  }
}
