/**
 * Simuleringsvärlden för synken (#1268, ADR 0037).
 *
 * En server (pglite bakom den riktiga tRPC-handlern, med synkstore och
 * omkörning) och flera klienter byggda som i webbläsaren: `createServerFirstStore`
 * + routrarna in-process, med procedurkön. Nätet styrs per klient via en
 * injicerad `fetch` — av, på, eller ett avbrott mitt i en synk.
 *
 * Servern loggar varje utfall den ger (accepterad, avvisad, konflikt) och i
 * vilken ordning den accepterade dem. Det är vad invarianterna prövas mot.
 */
import { createTRPCClient, type TRPCClient } from "@trpc/client";
import { GitBackendRuntime } from "@/lib/client/backend/git-backend-runtime";
import { InMemoryRejectedChangesPersistence, RejectedChanges } from "@/lib/client/backend/rejected-changes";
import { createServerFirstStore } from "@/lib/client/backend/server-first-store";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { GitAuthProvider } from "@/lib/server/auth/git-auth-provider";
import type { CachingSyncDataStore } from "@/lib/server/data-store/in-memory/caching-sync-data-store";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import {
  InMemoryMutationQueuePersistence, isProcedureCall, type QueuedMutation, type QueuedProcedureCall, type QueueEntry,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { DrizzleProcedureReplayer, type ProcedureReplayer } from "@/lib/server/sync/procedure-replayer";
import type { SyncStore } from "@/lib/server/sync/sync-store";
import type { UserRole } from "@/lib/shared/schemas/enums";
import { asId } from "@/lib/shared/schemas/ids";
import { createTestDb, type TestDbHandle } from "../../db/pg-test-db";

export const ORG = "00000000-0000-7000-8000-000000001268";
export const MATTER = "00000000-0000-7000-8000-00000000a001";

/** En användare per klient — samma id på servern och i klientens principal. */
export function userFor(index: number): { id: string; email: string; name: string } {
  return { id: `00000000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`, email: `jurist${index}@byra.se`, name: `Jurist ${index}` };
}

/** Ett utfall servern gav, i den ordning det kom. */
export type ServerOutcome =
  | { kind: "procedure"; call: QueuedProcedureCall; userId: string; status: "accepted" | "rejected" }
  | { kind: "row"; mutation: QueuedMutation; status: "accepted" | "rebased" | "conflict" };

/** Serverns sida: databasen, handlern och loggen över utfall. */
export class SimServer {
  readonly outcomes = new Map<string, ServerOutcome>();
  /** Accepterade ändringar i den ordning servern tillämpade dem (en gång per mutationId). */
  readonly applied: ServerOutcome[] = [];
  handler!: (req: Request) => Promise<Response>;
  repos!: DrizzleRepositories;
  handle!: TestDbHandle;

  static async start(userCount: number): Promise<SimServer> {
    const server = new SimServer();
    server.handle = await createTestDb();
    server.repos = await seedWorld(server.handle, userCount);
    const replayer = new DrizzleProcedureReplayer(server.handle.db, server.repos);
    server.handler = createServerTrpcHandler({
      repos: server.repos, ports: noopPorts, organizationId: ORG,
      sync: server.loggingSync(new DrizzleSyncStore(server.handle.db, server.repos)),
      replayer: server.loggingReplayer(replayer),
    });
    return server;
  }

  private record(id: string, outcome: ServerOutcome): void {
    const accepted = outcome.status === "accepted" || outcome.status === "rebased";
    if (accepted && !this.applied.some((o) => idOf(o) === id)) this.applied.push(outcome);
    this.outcomes.set(id, outcome);
  }

  private loggingSync(inner: SyncStore): SyncStore {
    return {
      pull: (org, cursor) => inner.pull(org, cursor),
      rows: (org, refs) => inner.rows(org, refs),
      push: async (org, mutation) => {
        const res = await inner.push(org, mutation);
        this.record(mutation.mutationId, { kind: "row", mutation, status: res.status });
        return res;
      },
    };
  }

  private loggingReplayer(inner: ProcedureReplayer): ProcedureReplayer {
    return {
      replay: async (call, ctx) => {
        const res = await inner.replay(call, ctx);
        this.record(call.mutationId, { kind: "procedure", call, userId: String(ctx.user?.id), status: res.status });
        return res;
      },
    };
  }
}

function idOf(o: ServerOutcome): string {
  return o.kind === "procedure" ? o.call.mutationId : o.mutation.mutationId;
}

/** Byrån, dess jurister och ärendet alla arbetar i. Samma i varje värld (för seriell omkörning). */
export async function seedWorld(handle: TestDbHandle, userCount: number): Promise<DrizzleRepositories> {
  const repos = buildDrizzleRepositories(handle.db);
  enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
  for (let i = 0; i < userCount; i++) {
    const u = userFor(i);
    // Via repot, så att användarna loggas i change_log och klienterna pullar dem.
    await repos.users.create({ id: u.id, organizationId: ORG, email: u.email, name: u.name, role: "LAWYER", active: true, hourlyRate: 150_000 } as never);
  }
  await repos.matters.create({
    id: MATTER, organizationId: ORG, title: "Simuleringsärendet", status: "ACTIVE", matterNumber: "2026-1268", paymentMethod: "PRIVAT", responsibleLawyerId: userFor(0).id,
  } as never);
  return repos;
}

/** En webbläsare: lokal store + kö + routrarna in-process, bakom ett nät som kan gå ned. */
export class SimClient {
  online = true;
  /** Antal anrop kvar innan nätet går ned mitt i en synk (null = inget avbrott planerat). */
  dropAfter: number | null = null;
  /** Varje köpost klienten någonsin haft — det som ska få ett utfall. */
  readonly seen = new Map<string, QueueEntry>();
  readonly rejected = new RejectedChanges(new InMemoryRejectedChangesPersistence());
  private readonly rejectedPersistence = new InMemoryRejectedChangesPersistence();
  private readonly persistence = new InMemoryPersistence();
  private readonly queuePersistence = new InMemoryMutationQueuePersistence();
  store!: CachingSyncDataStore;
  api!: TRPCClient<AppRouter>;

  constructor(readonly index: number, private readonly server: SimServer, private readonly role: UserRole = "LAWYER") {}

  /** Starta (eller starta om) från det som persisterats. */
  async boot(): Promise<void> {
    this.store = await createServerFirstStore({
      baseUrl: "http://sim.test", fetch: (input, init) => this.request(input, init),
      persistence: this.persistence, queuePersistence: this.queuePersistence, skipInitialReconcile: true,
      rejected: { changes: this.rejected, persistence: this.rejectedPersistence },
    });
    const u = userFor(this.index);
    const link = new GitBackendRuntime({
      dataStore: this.store.store,
      authProvider: new GitAuthProvider({ id: asId<"UserId">(u.id), email: u.email, name: u.name, role: this.role, organizationId: asId<"OrganizationId">(ORG) }),
      recordProcedure: (call, exec) => this.store.runQueuedProcedure(call, exec),
    }).createLink();
    this.api = createTRPCClient<AppRouter>({ links: [link] });
  }

  private async request(input: string | URL, init?: RequestInit): Promise<Response> {
    if (this.dropAfter !== null && this.dropAfter-- <= 0) { this.online = false; this.dropAfter = null; }
    if (!this.online) throw new TypeError("Failed to fetch (simulerat avbrott)");
    const headers = new Headers(init?.headers);
    headers.set("X-Auth-Request-Email", userFor(this.index).email);
    return this.server.handler(new Request(input, { ...init, headers }));
  }

  /** Notera köns poster (före och efter varje steg). */
  observeQueue(): void {
    for (const e of this.store.pendingEntries()) this.seen.set(e.mutationId, e);
  }

  /** Synka; ett nätfel är ett förväntat utfall offline. */
  async sync(): Promise<"ok" | "failed"> {
    this.observeQueue();
    try {
      await this.store.reconcile();
      return "ok";
    } catch {
      return "failed";
    } finally {
      this.observeQueue();
    }
  }

  /** Lokala rader (inte borttagna) för en entitet. */
  rows(key: "timeEntries" | "contacts" | "invoices"): Array<Record<string, unknown>> {
    return (this.store.store.currentSource[key] ?? []).filter((r) => r.deletedAt == null);
  }
}

export function isProcedure(e: QueueEntry): e is QueuedProcedureCall {
  return isProcedureCall(e);
}
