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
import { MAX_ROW_REFS } from "@/lib/server/data-store/in-memory/sync-transport";
import { users } from "@/lib/server/db/schema";
import { createServerTrpcHandler } from "@/lib/server/http/server-trpc-handler";
import { createDbChangeLogRecorder, enableChangeLogOnAll } from "@/lib/server/repositories/change-log-recorder";
import { buildDrizzleRepositories, type DrizzleRepositories } from "@/lib/server/repositories/drizzle-repositories";
import type { AppRouter } from "@/lib/server/routers/_app";
import { DrizzleSyncStore } from "@/lib/server/sync/drizzle-sync-store";
import { asId } from "@/lib/shared/schemas/ids";
import { uuidv7 } from "@/lib/shared/uuid";
import { createTestDb, type TestDbHandle } from "../../server/db/pg-test-db";

const ORG = uuidv7();

describe("TrpcSyncTransport (#sync-bridge, end-to-end)", () => {
  let handle: TestDbHandle;
  let repos: DrizzleRepositories;
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

  it("rows (#1348): byråns rad som den är; saknad, annan byrås och icke-uuid → tombstone; okänd entitet hoppas", async () => {
    const mine = uuidv7();
    const theirs = uuidv7();
    const missing = uuidv7();
    await repos.contacts.create({ id: mine, organizationId: ORG, name: "Min kontakt" } as never);
    await repos.contacts.create({ id: theirs, organizationId: uuidv7(), name: "Annan byrås kontakt" } as never);
    const res = await transport.rows([
      { entity: "contact", id: mine },
      { entity: "contact", id: theirs },
      { entity: "contact", id: missing },
      { entity: "contact", id: "inte-ett-uuid" },
      { entity: "widget", id: mine },
    ]);
    expect(res).toEqual([
      { entity: "contact", row: expect.objectContaining({ id: mine, name: "Min kontakt" }) },
      { entity: "contact", row: { id: theirs }, deleted: true },
      { entity: "contact", row: { id: missing }, deleted: true },
      { entity: "contact", row: { id: "inte-ett-uuid" }, deleted: true },
    ]);
  });

  it("rows: fler än gränsen avvisas av servern", async () => {
    const refs = Array.from({ length: MAX_ROW_REFS + 1 }, () => ({ entity: "contact", id: uuidv7() }));
    await expect(transport.rows(refs)).rejects.toThrow();
  });
});
