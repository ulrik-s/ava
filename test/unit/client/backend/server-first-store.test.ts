/**
 * `createServerFirstStore` (#2b) — self-hosted-klientens offline-first-store i
 * server-first-läge, end-to-end mot den RIKTIGA server-handlern (#410) + Drizzle-
 * repos över Postgres (pglite/PG via createTestDb). Bevisar att klienten pullar
 * server-data initialt och pushar lokala mutationer vid reconcile.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { createServerFirstStore } from "@/lib/client/backend/server-first-store";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import { InMemoryMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../../server/db/pg-test-db";

const ORG = uuidv7();

describe("createServerFirstStore (#2b)", () => {
  let handle: TestDbHandle;
  let repos: Repositories;
  let handler: (req: Request) => Promise<Response>;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await handle.db.insert(users).values(
      v({ id: uuidv7(), organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true }),
    );
    handler = createServerTrpcHandler({ repos, ports: noopPorts, organizationId: ORG, sync: new DrizzleSyncStore(handle.db, repos) });
  });
  afterAll(async () => { await handle.close(); });

  /** Injicerad fetch → server-handlern, med oauth2-proxy-email (kringgår happy-dom-CORS). */
  const fetchToServer = (input: string | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers);
    headers.set("X-Auth-Request-Email", "anna@byra.se");
    return handler(new Request(input as string, { ...init, headers } as RequestInit));
  };

  function makeStore() {
    return createServerFirstStore({
      baseUrl: "http://ava.test",
      fetch: fetchToServer,
      persistence: new InMemoryPersistence(),
      queuePersistence: new InMemoryMutationQueuePersistence(),
    });
  }

  it("initial reconcile pullar server-skapade rader till den lokala store:n", async () => {
    const m1 = uuidv7();
    await repos.matters.create({ id: m1, organizationId: ORG, title: "Server-ärende", status: "ACTIVE", matterNumber: "2026-0200" } as never);

    const ds = await makeStore(); // create() gör initial reconcile (pull)
    expect(await ds.store.matters.findUnique({ where: { id: m1 } })).toMatchObject({ id: m1, title: "Server-ärende" });
  });

  it("lokal mutation köas och pushas server-auktoritativt vid reconcile", async () => {
    const ds = await makeStore();
    const m2 = uuidv7();
    await ds.store.matters.create({ data: { id: m2, organizationId: ORG, title: "Klient-ärende", status: "ACTIVE", matterNumber: "2026-0201" } as never });
    expect(ds.pendingCount()).toBe(1); // köad lokalt, ej synkad

    await ds.reconcile();
    expect(ds.pendingCount()).toBe(0); // pushad + ack:ad
    expect(await repos.matters.getById(asId<"MatterId">(m2))).toMatchObject({ id: m2, title: "Klient-ärende" }); // server fick den
  });
});
