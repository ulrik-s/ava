/**
 * `createServerFirstStore`: den första synken går under synklåset (#1758),
 * som den löpande, så att flikar som laddas samtidigt inte spelar upp samma
 * kö mot servern samtidigt.
 */
import { describe, expect, it } from "vitest-compat";
import { createServerFirstStore } from "@/lib/client/backend/server-first-store";
import { SYNC_LOCK_NAME } from "@/lib/client/sync/sync-lock";
import { InMemoryPersistence } from "@/lib/server/data-store/in-memory/local-store-persistence";
import { InMemoryMutationQueuePersistence } from "@/lib/server/data-store/in-memory/mutation-queue";
import { fakeLocks, type FakeLocks } from "../../../helpers/fake-locks";

/** Ett tomt pull-svar från servern. */
const emptyPull = (): Response =>
  new Response(JSON.stringify([{ result: { data: { json: { changes: [], cursor: 0 } } } }]), { headers: { "content-type": "application/json" } });

function makeStore(locks: FakeLocks, fetch: (input: string | URL) => Promise<Response>, skipInitialReconcile = false) {
  return createServerFirstStore({
    baseUrl: "http://ava.test",
    fetch,
    locks,
    skipInitialReconcile,
    local: "binding",
    persistence: new InMemoryPersistence(),
    queuePersistence: new InMemoryMutationQueuePersistence(),
  });
}

describe("createServerFirstStore — synklåset (#1758)", () => {
  it("låset `ava-sync` hålls när den första synkens anrop når servern", async () => {
    const locks = fakeLocks();
    const heldAtServer: boolean[] = [];
    await makeStore(locks, () => { heldAtServer.push(locks.held()); return Promise.resolve(emptyPull()); });
    expect(heldAtServer.length).toBeGreaterThan(0);
    expect(heldAtServer.every(Boolean)).toBe(true);
    expect(locks.names).toEqual([SYNC_LOCK_NAME]);
    expect(locks.held()).toBe(false);
  });

  it("med skipInitialReconcile begärs inget lås", async () => {
    const locks = fakeLocks();
    await makeStore(locks, () => Promise.reject(new Error("ingen server i testet")), true);
    expect(locks.names).toEqual([]);
  });

  it("ett fel i den första synken fäller inte uppstarten, och låset släpps", async () => {
    const locks = fakeLocks();
    const store = await makeStore(locks, () => Promise.reject(new Error("nätet")));
    expect(store.pendingEntries()).toEqual([]);
    expect(locks.names).toEqual([SYNC_LOCK_NAME]);
    expect(locks.held()).toBe(false);
  });
});
