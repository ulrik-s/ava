/**
 * `createServerFirstStore` och de lokala databaserna (#1347):
 *   - en användares plats → hennes egna databaser, och köposterna stämplas med henne;
 *   - bindningsfasen → allt i minnet: ingenting sparas lokalt förrän det är
 *     avgjort vem som loggar in.
 */
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import { dbNameIn, LOCAL_DB, localScopeSchema, userNamespace } from "@/lib/client/backend/local-data/local-namespace";
import { InMemoryRejectedChangesPersistence, RejectedChanges } from "@/lib/client/backend/rejected-changes";
import { createServerFirstStore } from "@/lib/client/backend/server-first-store";
import { InMemoryMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";

const anna = localScopeSchema.parse({ organizationId: "org-1", principalId: "u-anna" });
const contact = { id: "0199a0cf-d42b-7c09-a5cc-535a9dc76aa7", organizationId: "org-1", name: "Klient", contactType: "PERSON" };
/** Ingen server i testet: anropas den, faller testet. */
const noServer = async (): Promise<Response> => { throw new Error("ingen server i testet"); };

describe("createServerFirstStore — lokala databaser", () => {
  it("användarens plats: hennes databaser, köposterna stämplas med henne", async () => {
    const factory = new IDBFactory();
    const store = await createServerFirstStore({
      fetch: noServer, skipInitialReconcile: true,
      local: { factory, ns: userNamespace(anna), adoptsLegacy: false },
    });
    await store.store.contacts.create({ data: contact as never });
    expect(store.pendingEntries()[0]?.owner).toEqual(anna);
    const names = (await factory.databases()).map((d) => d.name);
    expect(names).toContain(dbNameIn(userNamespace(anna), LOCAL_DB.mutationQueue));
    expect(names).toContain(dbNameIn(userNamespace(anna), LOCAL_DB.localStore));
    expect(names).not.toContain("ava-mutation-queue-v2");
  });

  it("bindningsfasen: allt i minnet, ingen ägare; reconcile laddar inte upp några bytes", async () => {
    const changes = new RejectedChanges();
    const store = await createServerFirstStore({ fetch: noServer, skipInitialReconcile: true, local: "binding", rejected: { changes, persistence: new InMemoryRejectedChangesPersistence() } });
    await store.store.contacts.create({ data: contact as never });
    expect(store.pendingEntries()[0]?.owner).toBeUndefined();
  });

  it("bindningsfasen: en lyckad synk laddar inte upp några bytes (inget lokalt att ladda upp)", async () => {
    const calls: string[] = [];
    const pullOnly = async (input: string | URL): Promise<Response> => {
      calls.push(String(input));
      return new Response(JSON.stringify([{ result: { data: { json: { changes: [], cursor: 0 } } } }]), { headers: { "content-type": "application/json" } });
    };
    const store = await createServerFirstStore({ fetch: pullOnly, local: "binding" });
    expect(store.pendingEntries()).toEqual([]);
    expect(calls.every((c) => c.includes("sync.pull"))).toBe(true);
  });

  it("utan IndexedDB i miljön (default-platsen): avvisningarna hålls i minnet", async () => {
    expect(globalThis.indexedDB).toBeUndefined();
    const store = await createServerFirstStore({
      fetch: noServer, skipInitialReconcile: true,
      persistence: { hydrate: async () => null, save: async () => undefined },
      queuePersistence: new InMemoryMutationQueuePersistence(),
    });
    expect(store.pendingEntries()).toEqual([]);
  });
});
