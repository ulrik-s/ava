/**
 * `TrpcSyncTransport` (#sync-bridge) — end-to-end: klientens SyncTransport pullar/
 * pushar mot den RIKTIGA server-runtimens `sync`-router (#410 handler + #415-port)
 * via en tRPC-klient. Stänger bryggan offline-kö ↔ auktoritativ Postgres.
 */

import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import superjson from "superjson";
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { TrpcSyncTransport } from "@/lib/client/sync/trpc-sync-transport";
import { noopPorts } from "@/lib/server/adapters/noop-ports";
import type { QueuedMutation } from "@/lib/server/data-store/in-memory/mutation-queue";
import { users } from "@/lib/server/db/schema";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { Repositories } from "@/lib/server/repositories/repositories";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../../server/db/pg-test-db";

const ORG = uuidv7();

describe("TrpcSyncTransport (#sync-bridge, end-to-end)", () => {
  let handle: TestDbHandle;
  let repos: Repositories;
  let transport: TrpcSyncTransport;

  beforeAll(async () => {
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await handle.db.insert(users).values(
      v({ id: uuidv7(), organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true }),
    );
    const handler = createServerTrpcHandler({
      repos,
      ports: noopPorts,
      organizationId: ORG,
      sync: new DrizzleSyncStore(handle.db, repos),
    });
    const client: TRPCClient<AppRouter> = createTRPCClient<AppRouter>({
      links: [
        httpBatchLink({
          url: "http://ava.test/api/trpc",
          transformer: superjson,
          fetch: (input, init) => {
            const headers = new Headers(init?.headers as HeadersInit | undefined);
            headers.set("X-Auth-Request-Email", "anna@byra.se");
            return handler(new Request(input as string, { ...init, headers } as RequestInit));
          },
        }),
      ],
    });
    transport = new TrpcSyncTransport(client);
  });
  afterAll(async () => { await handle.close(); });

  it("pull:ar server-skapade rader över tRPC", async () => {
    const m1 = uuidv7();
    await repos.matters.create({ id: m1, organizationId: ORG, title: "E2E-ärende", status: "ACTIVE", matterNumber: "2026-0011" } as never);

    const res = await transport.pull(0);
    expect(res.cursor).toBeGreaterThan(0);
    expect(res.changes.some((c) => c.row.id === m1)).toBe(true);
  });

  it("push:ar en köad mutation som applikeras server-auktoritativt", async () => {
    const c1 = uuidv7();
    const mutation: QueuedMutation = {
      mutationId: uuidv7(),
      entity: "contact",
      kind: "create",
      row: { id: c1, organizationId: ORG, name: "E2E-kontakt" },
      enqueuedAt: 0,
    };
    const res = await transport.push(mutation);
    expect(res.status).toBe("accepted");
    expect(await repos.contacts.getById(asId<"ContactId">(c1))).toMatchObject({ id: c1, name: "E2E-kontakt" });
  });
});
