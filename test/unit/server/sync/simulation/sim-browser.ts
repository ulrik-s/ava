/**
 * Webbläsarna i simuleringen (#1268, #1358).
 *
 * En `SimBrowser` är en användares webbläsare: EN IndexedDB (fake-indexeddb)
 * som alla dess flikar delar — kön post för post (#1346/#1377), det lokala
 * snapshotet och de avvisade ändringarna — en kanal mellan flikarna och
 * synklåset (Web Locks, #1332). Webbläsaren har den roll som var cachad när
 * den senast var online; servern kan ha en annan (degraderad användare).
 *
 * En `SimTab` är en flik: `createServerFirstStore` + routrarna in-process med
 * procedurkön, precis som i webbläsaren. Nätet styrs per flik — av, på, ett
 * avbrott mitt i en synk, eller ett svar som tappas efter att servern
 * redan behandlat anropet. Anropen går via `SimNetwork`, som bestämmer
 * ordningen.
 */
import { createTRPCClient, type TRPCClient } from "@trpc/client";
import { IDBFactory } from "fake-indexeddb";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { IndexedDbRejectedChangesPersistence, RejectedChanges, type RejectedChange } from "@/lib/client/backend/rejected-changes";
import { createServerFirstStore } from "@/lib/client/backend/server-first-store";
import { withSyncLock } from "@/lib/client/sync/sync-lock";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { IndexedDbPersistence } from "@/lib/server/data-store/in-memory/indexeddb-persistence";
import {
  IndexedDbMutationQueuePersistence, isProcedureCall, type MutationQueuePersistence, type QueueEntry,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import type { BlockedEntry } from "@/lib/server/data-store/in-memory/reconcile-engine";
import type { AppRouter } from "@/lib/server/routers/_app";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { changeChannelHub } from "../../../../helpers/change-channel-hub";
import { SimLock, type SimNetwork } from "./sim-network";
import { firmOf, type Firm, type SimServer, type SimUser } from "./sync-world";

/**
 * Kön som webbläsaren sparar den, med en logg över varje post som någonsin
 * lagts i den: det som ska få ett utfall på servern. Loggen fångar också
 * poster som en annan flik hann skicka innan steget var slut.
 */
class RecordingQueuePersistence implements MutationQueuePersistence {
  constructor(private readonly inner: IndexedDbMutationQueuePersistence, private readonly seen: Map<string, QueueEntry>) {}
  load(): Promise<QueueEntry[]> { return this.inner.load(); }
  add(entry: QueueEntry): Promise<void> { this.seen.set(entry.mutationId, entry); return this.inner.add(entry); }
  replace(entry: QueueEntry): Promise<void> { this.seen.set(entry.mutationId, entry); return this.inner.replace(entry); }
  delete(mutationId: string): Promise<void> { return this.inner.delete(mutationId); }
  subscribe(listener: () => void): () => void { return this.inner.subscribe(listener); }
}

export class SimBrowser {
  private readonly factory = new IDBFactory();
  private readonly channels = changeChannelHub();
  /** Varje köpost webbläsaren någonsin haft — det som ska få ett utfall. */
  readonly seen = new Map<string, QueueEntry>();
  readonly lock = new SimLock();
  readonly firm: Firm;

  constructor(
    readonly name: string,
    readonly user: SimUser,
    /** Rollen webbläsaren har cachad (kan skilja sig från serverns). */
    readonly cachedRole: UserRole,
    /** Web Locks finns (säker sida). Annars synkar flikarna utan lås, som förut. */
    readonly useLocks: boolean,
  ) {
    this.firm = firmOf(user.id);
  }

  queuePersistence(): MutationQueuePersistence {
    return new RecordingQueuePersistence(new IndexedDbMutationQueuePersistence(this.factory, "ava-mutation-queue", this.channels()), this.seen);
  }

  sourcePersistence(): IndexedDbPersistence {
    return new IndexedDbPersistence(this.factory);
  }

  rejectedPersistence(): IndexedDbRejectedChangesPersistence {
    return new IndexedDbRejectedChangesPersistence(this.factory, "ava-rejected-changes", this.channels());
  }

  /** Avvisade ändringar så som de är sparade (det användaren ser). */
  rejected(): Promise<RejectedChange[]> {
    return new IndexedDbRejectedChangesPersistence(this.factory).load();
  }

  async rejectedIds(): Promise<Set<string>> {
    return new Set((await this.rejected()).map((c) => c.id));
  }

  /** Köns poster så som de är sparade (vad en nyöppnad flik ser). */
  storedQueue(): Promise<QueueEntry[]> {
    return new IndexedDbMutationQueuePersistence(this.factory).load();
  }
}

type SourceRows = Array<Record<string, unknown>>;

export class SimTab {
  online = true;
  /** Antal anrop kvar innan nätet går ned mitt i en synk (null = inget avbrott planerat). */
  dropAfter: number | null = null;
  /** Nästa svar tappas efter att servern behandlat anropet. */
  loseNextResponse = false;
  store!: CachingSyncDataStore;
  api!: TRPCClient<AppRouter>;

  constructor(readonly name: string, readonly browser: SimBrowser, private readonly server: SimServer, private readonly net: SimNetwork) {}

  get user(): SimUser { return this.browser.user; }
  get firm(): Firm { return this.browser.firm; }

  /** Starta (eller starta om) fliken från det som persisterats i webbläsaren. */
  async boot(): Promise<void> {
    this.store = await createServerFirstStore({
      baseUrl: "http://sim.test", fetch: (input, init) => this.request(input, init),
      persistence: this.browser.sourcePersistence(), queuePersistence: this.browser.queuePersistence(), skipInitialReconcile: true,
      rejected: { changes: new RejectedChanges(), persistence: this.browser.rejectedPersistence() },
    });
    const u = this.user;
    const link = new GitBackendRuntime({
      dataStore: this.store.store,
      authProvider: new GitAuthProvider({
        id: asId<"UserId">(u.id), email: u.email, name: u.name, role: this.browser.cachedRole, organizationId: asId<"OrganizationId">(this.firm.org),
      }),
      recordProcedure: (call, exec) => this.store.runQueuedProcedure(call, exec),
    }).createLink();
    this.api = createTRPCClient<AppRouter>({ links: [link] });
  }

  private async request(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (this.dropAfter !== null && this.dropAfter-- <= 0) { this.online = false; this.dropAfter = null; }
    if (!this.online) throw new TypeError("Failed to fetch (simulerat avbrott)");
    const req = new Request(input, init);
    return this.net.send(this.name, async () => {
      const res = await this.server.serve(this.user, req);
      if (!this.loseNextResponse) return res;
      this.loseNextResponse = false;
      throw new TypeError("Failed to fetch (svaret tappades)");
    });
  }

  /** Synka under webbläsarens synklås; ett nätfel är ett förväntat utfall offline. */
  async sync(): Promise<"ok" | "failed"> {
    const locks = this.browser.useLocks ? this.browser.lock.locksFor(this.name) : undefined;
    try {
      const result = await withSyncLock(() => this.store.reconcile(), locks);
      if (result.blocked && process.env.AVA_SIM_DEBUG) console.log("KÖN STANNADE", this.name, describeBlocked(result.blocked));
      return "ok";
    } catch {
      return "failed";
    }
  }

  /** Lokala rader (inte borttagna) under en source-nyckel. */
  rows(key: string): SourceRows {
    const rows: unknown = Reflect.get(this.store.store.currentSource, key);
    if (!Array.isArray(rows)) return [];
    return rows.filter((row: unknown): row is Record<string, unknown> => isRecord(row) && row.deletedAt == null);
  }
}

function describeBlocked(b: BlockedEntry): string {
  const what = isProcedureCall(b.mutation) ? b.mutation.path : `${b.mutation.entity}/${b.mutation.kind}`;
  return `${what} efter ${b.attempts} försök: ${b.error instanceof Error ? b.error.message.slice(0, 300) : String(b.error)}`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
