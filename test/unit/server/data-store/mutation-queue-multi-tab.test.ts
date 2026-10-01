/**
 * Kön med flera flikar (#1346) — varje flik har en egen `MutationQueue` över
 * samma IndexedDB. Ingen flik får skriva över en annan fliks köade ändringar.
 *
 * Två `MutationQueue`-instanser över samma `IDBFactory` + databasnamn = två
 * flikar i samma webbläsare.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest-compat";
import { IdbKv } from "@/lib/server/data-store/in-memory/idb-kv";
import {
  InMemoryMutationQueuePersistence, IndexedDbMutationQueuePersistence, MutationQueue, type QueuedMutation,
} from "@/lib/server/data-store/in-memory/mutation-queue";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";
import { changeChannelHub, settle } from "../../../helpers/change-channel-hub";

const ev = (id: string): MutationEvent<Record<string, unknown>> => ({ entity: "matter", kind: "update", row: { id } });

/** Två flikar som öppnar samma kö-databas. */
async function twoTabs(dbName: string): Promise<{ factory: IDBFactory; a: MutationQueue; b: MutationQueue }> {
  const factory = new IDBFactory();
  const a = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, dbName));
  const b = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, dbName));
  return { factory, a, b };
}

/** Vad en nyöppnad flik ser (lagringen, inte någon fliks minne). */
async function stored(factory: IDBFactory, dbName: string): Promise<string[]> {
  const fresh = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, dbName));
  return fresh.pending().map((e) => e.mutationId);
}

describe("MutationQueue — flera flikar (#1346)", () => {
  it("flik A köar X, flik B köar Y utan att känna till X, A stängs → X finns kvar", async () => {
    const { factory, a, b } = await twoTabs("tabs-issue");
    await a.enqueue(ev("x"), { mutationId: "X", now: 1 });
    await b.enqueue(ev("y"), { mutationId: "Y", now: 2 });
    expect(await stored(factory, "tabs-issue")).toEqual(["X", "Y"]);
  });

  it("en flik som tömmer kön kvitterar bara det den skickat — en annan fliks nya post ligger kvar", async () => {
    const { factory, a, b } = await twoTabs("tabs-ack");
    await a.enqueue(ev("x"), { mutationId: "X", now: 1 });
    await b.refresh();
    await a.enqueue(ev("z"), { mutationId: "Z", now: 3 });
    for (const e of [...b.pending()]) await b.ack(e.mutationId);
    expect(await stored(factory, "tabs-ack")).toEqual(["Z"]);
  });

  it("refresh läser lagringen: en flik ser en annan fliks poster i köordning", async () => {
    const { a, b } = await twoTabs("tabs-refresh");
    await a.enqueue(ev("x"), { mutationId: "X", now: 5 });
    await b.enqueue(ev("y"), { mutationId: "Y", now: 6 });
    await a.enqueue(ev("z"), { mutationId: "Z", now: 7 });
    expect(b.pending().map((e) => e.mutationId)).toEqual(["Y"]);
    await b.refresh();
    expect(b.pending().map((e) => e.mutationId)).toEqual(["X", "Y", "Z"]);
  });

  it("en kvittering i en flik försvinner ur den andra vid nästa refresh", async () => {
    const { a, b } = await twoTabs("tabs-ack-refresh");
    await a.enqueue(ev("x"), { mutationId: "X", now: 1 });
    await b.refresh();
    await a.ack("X");
    await b.refresh();
    expect(b.size()).toBe(0);
  });

  it("samma mutationId från två flikar köas en gång", async () => {
    const { factory, a, b } = await twoTabs("tabs-dupe");
    await a.enqueue(ev("x"), { mutationId: "X", now: 1 });
    await b.enqueue(ev("x"), { mutationId: "X", now: 1 });
    expect(await stored(factory, "tabs-dupe")).toEqual(["X"]);
  });
});

describe("MutationQueue — ersätt och töm med flera flikar (#1346)", () => {
  it("replaceAll ersätter på plats och tar bara bort det fliken kände till — en annan fliks post ligger kvar", async () => {
    const { factory, a, b } = await twoTabs("tabs-replace");
    await a.enqueue(ev("x"), { mutationId: "X", now: 1 });
    await a.enqueue(ev("w"), { mutationId: "W", now: 2 });
    await b.enqueue(ev("y"), { mutationId: "Y", now: 3 });
    const repaired: QueuedMutation = { mutationId: "X", entity: "matter", kind: "update", row: { id: "x2" }, enqueuedAt: 1 };
    await a.replaceAll([repaired]);
    const fresh = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "tabs-replace"));
    expect(fresh.pending()).toEqual([repaired, expect.objectContaining({ mutationId: "Y" })]);
  });

  it("clear tar bort flikens poster, inte en annan fliks", async () => {
    const { factory, a, b } = await twoTabs("tabs-clear");
    await a.enqueue(ev("x"), { mutationId: "X", now: 1 });
    await b.enqueue(ev("y"), { mutationId: "Y", now: 2 });
    await a.clear();
    expect(a.size()).toBe(0);
    expect(await stored(factory, "tabs-clear")).toEqual(["Y"]);
  });
});

describe("MutationQueue — signal från andra flikar (#1346)", () => {
  it("en annan fliks enqueue → kön läses om och lyssnaren anropas", async () => {
    const factory = new IDBFactory();
    const hub = changeChannelHub();
    const a = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "tabs-signal", hub()));
    const b = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "tabs-signal", hub()));
    const sizes: number[] = [];
    const off = b.onExternalChange(() => sizes.push(b.size()));
    await a.enqueue(ev("x"), { mutationId: "X", now: 1 });
    await settle();
    expect(sizes).toEqual([1]);
    off();
    await a.ack("X");
    await settle();
    expect(sizes).toEqual([1]);
  });

  it("utan persistens eller utan signal → ingen prenumeration", () => {
    expect(() => new MutationQueue().onExternalChange(() => undefined)()).not.toThrow();
    expect(() => new MutationQueue(new InMemoryMutationQueuePersistence()).onExternalChange(() => undefined)()).not.toThrow();
  });
});

describe("MutationQueue — en misslyckad skrivning", () => {
  it("avvisas, och flikens nästa köoperation körs ändå", async () => {
    const persistence = new InMemoryMutationQueuePersistence();
    const add = persistence.add.bind(persistence);
    let fail = true;
    persistence.add = async (entry) => {
      if (fail) throw new Error("lagringen full");
      await add(entry);
    };
    const q = await MutationQueue.hydrate(persistence);
    await expect(q.enqueue(ev("x"), { mutationId: "X" })).rejects.toThrow("lagringen full");
    fail = false;
    await q.enqueue(ev("y"), { mutationId: "Y" });
    expect((await persistence.load()).map((e) => e.mutationId)).toEqual(["Y"]);
  });
});

describe("MutationQueue — in-memory-persistens per post", () => {
  it("replace ersätter på plats eller lägger sist; delete tar bort; add är idempotent", async () => {
    const p = new InMemoryMutationQueuePersistence();
    const entry = (id: string, rowId: string): QueuedMutation => ({ mutationId: id, entity: "matter", kind: "update", row: { id: rowId }, enqueuedAt: 0 });
    await p.add(entry("a", "1"));
    await p.add(entry("a", "dubblett"));
    await p.replace(entry("b", "1"));
    await p.replace(entry("a", "2"));
    expect((await p.load()).map((e) => [e.mutationId, "row" in e ? e.row.id : null])).toEqual([["a", "2"], ["b", "1"]]);
    await p.delete("a");
    expect((await p.load()).map((e) => e.mutationId)).toEqual(["b"]);
  });
});

describe("MutationQueue — uppgradering från kön under en nyckel (#1346)", () => {
  const fixture = JSON.parse(readFileSync(join(process.cwd(), "test/fixtures/local-data/release-2026-09.json"), "utf8")) as { queue: unknown[] };

  it("en kö sparad av förra releasen flyttas post för post — ingen post tappas, den gamla nyckeln tas bort", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "ava-queue-upgrade", "queue").put("pending", fixture.queue);
    const queue = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "ava-queue-upgrade"));
    expect(queue.pending()).toEqual(fixture.queue);
    await queue.ack("01928f3a-0000-7000-8000-000000000010");
    expect(await stored(factory, "ava-queue-upgrade")).toEqual(["01928f3a-0000-7000-8000-000000000011"]);
  });

  it("en flik med gammal kod fortsätter köa under tiden: allt når den nya kön en gång, och en kvitterad post köas inte om", async () => {
    const factory = new IDBFactory();
    const [first, second] = fixture.queue;
    const oldTab = new IdbKv(factory, "ava-queue-live", "queue");
    await oldTab.put("pending", [first]);
    const queue = await MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "ava-queue-live"));
    await queue.enqueue(ev("ny"), { mutationId: "NY", now: 5 });
    await queue.ack("01928f3a-0000-7000-8000-000000000010");
    await oldTab.put("pending", [first, second]); // den gamla fliken skriver hela sin kö igen
    await queue.refresh();
    expect(queue.pending().map((e) => e.mutationId)).toEqual(["NY", "01928f3a-0000-7000-8000-000000000011"]);
    expect(await stored(factory, "ava-queue-live")).toEqual(["NY", "01928f3a-0000-7000-8000-000000000011"]);
  });

  it("två flikar som öppnar den uppgraderade kön samtidigt ser samma poster en gång", async () => {
    const factory = new IDBFactory();
    await new IdbKv(factory, "ava-queue-upgrade-2", "queue").put("pending", fixture.queue);
    const [a, b] = await Promise.all([
      MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "ava-queue-upgrade-2")),
      MutationQueue.hydrate(new IndexedDbMutationQueuePersistence(factory, "ava-queue-upgrade-2")),
    ]);
    expect(a.size()).toBe(2);
    expect(b.size()).toBe(2);
    expect(await stored(factory, "ava-queue-upgrade-2")).toHaveLength(2);
  });
});
