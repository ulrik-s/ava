/**
 * `createServerFirstStore` (#2b) — self-hosted-klientens offline-first-store i
 * server-first-läge, end-to-end mot den RIKTIGA server-handlern (#410) + Drizzle-
 * repos över Postgres (pglite/PG via createTestDb). Bevisar att klienten pullar
 * server-data initialt och pushar lokala mutationer vid reconcile.
 */

import { IDBFactory } from "fake-indexeddb";
import { describe, it, expect, beforeAll, afterAll } from "vitest-compat";
import { DocumentContentCache } from "@/lib/client/backend/content-cache";
import { createServerFirstStore, serverDocumentId } from "@/lib/client/backend/server-first-store";
import { saveGeneratedDocBlob } from "@/lib/client/demo/generated-doc-idb";
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

describe("räddning av lokalt genererade dokument (#1143, end-to-end)", () => {
  let handle: TestDbHandle;
  let repos: Repositories;
  let handler: (req: Request) => Promise<Response>;
  const content = new Map<string, Uint8Array>();
  const memContent = {
    write: async (p: string, b: Uint8Array) => { content.set(p, b); },
    read: async (p: string) => content.get(p) ?? null,
    exists: async (p: string) => content.has(p),
  };
  const prevIdb = Reflect.get(globalThis, "indexedDB");

  beforeAll(async () => {
    Reflect.set(globalThis, "indexedDB", new IDBFactory());
    handle = await createTestDb();
    repos = buildDrizzleRepositories(handle.db);
    enableChangeLogOnAll(repos, createDbChangeLogRecorder(handle.db));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = (o: Record<string, unknown>) => ({ version: 1, ...o }) as any;
    await handle.db.insert(users).values(v({ id: USER, organizationId: ORG, email: "anna@byra.se", name: "Anna", role: "LAWYER", active: true }));
    handler = createServerTrpcHandler({ repos, ports: { ...noopPorts, content: memContent }, organizationId: ORG, sync: new DrizzleSyncStore(handle.db, repos) });
  });
  afterAll(async () => {
    await handle.close();
    Reflect.set(globalThis, "indexedDB", prevIdb);
  });

  const USER = uuidv7();

  it("dokument med metadata men utan innehåll på servern får innehållet ur webbläsarens IndexedDB", async () => {
    // Som F-2026-0001 på ava-crm.io: genererat under ett gammalt icke-uuid-id,
    // raden reparerad till uuidv5 (#1124), innehållet bara lokalt.
    const legacyId = "faktura-muehzopb-872k6k";
    const docId = serverDocumentId(legacyId);
    const matterId = uuidv7();
    await repos.matters.create({ id: matterId, organizationId: ORG, title: "Ärende", status: "ACTIVE", matterNumber: "2026-0001" } as never);
    await repos.documents.create({
      id: docId, matterId, fileName: "Faktura F-2026-0001.html", mimeType: "text/html; charset=utf-8", sizeBytes: 5,
      storagePath: `documents/content/${legacyId}.html`, uploadedById: USER,
    } as never);
    const bytes = new TextEncoder().encode("<html>F-2026-0001</html>");
    await saveGeneratedDocBlob({ id: legacyId, storagePath: `documents/content/${legacyId}.html`, fileName: "f.html", mimeType: "text/html", bytes });

    await createServerFirstStore({
      baseUrl: "http://ava.test",
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("X-Auth-Request-Email", "anna@byra.se");
        return handler(new Request(input as string, { ...init, headers } as RequestInit));
      },
      persistence: new InMemoryPersistence(),
      queuePersistence: new InMemoryMutationQueuePersistence(),
    });

    const doc = await repos.documents.getById(docId);
    const stored = content.get(String(doc?.storagePath));
    expect(stored && new TextDecoder().decode(stored)).toBe("<html>F-2026-0001</html>");
    expect(await new DocumentContentCache().pendingUploads()).toEqual([]);
  });
});

describe("serverDocumentId (#1143)", () => {
  it("översätter ett gammalt lokalt id som legacy-id-reparationen — träffar prod-dokumentet", () => {
    // Fakturadokumentet F-2026-0001 på ava-crm.io: lokalt id → id i databasen.
    expect(serverDocumentId("faktura-muehzopb-872k6k")).toBe("ed918397-059b-5aa5-ab8f-42100337c433");
    // uuid lämnas orört.
    expect(serverDocumentId("01a0cfd4-2b5c-7097-a5cc-535a9dc76aa7")).toBe("01a0cfd4-2b5c-7097-a5cc-535a9dc76aa7");
  });
});
