/**
 * `QueueSnapshotTab` (#1714): flikens märken — vilka köposters rader dess
 * minne bär, och vilka rader som ska läsas om från servern.
 */

import { describe, expect, it } from "vitest-compat";
import { InMemoryMutationQueuePersistence, MutationQueue } from "@/lib/server/data-store/in-memory/mutation-queue";
import { QueueSnapshotTab } from "@/lib/server/data-store/in-memory/snapshot-tab";
import type { RowRef } from "@/lib/server/data-store/in-memory/sync-transport";
import type { MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";

const ev = (id: string): MutationEvent<Record<string, unknown>> => ({ entity: "timeEntry", kind: "update", row: { id } });
const ref = (id: string): RowRef => ({ entity: "timeEntry", id });

/** Motorns lista, utan motor. */
function fakeEngine() {
  const refs: RowRef[] = [];
  return { refs, restoreLater: (more: readonly RowRef[]) => { refs.push(...more); }, owed: () => refs };
}

/** Två flikar över samma kö. */
async function twoQueues() {
  const storage = new InMemoryMutationQueuePersistence();
  return { a: await MutationQueue.hydrate(storage), b: await MutationQueue.hydrate(storage), storage };
}

describe("QueueSnapshotTab", () => {
  it("märker flikens egna köposter med raderna de skrev", async () => {
    const queue = new MutationQueue();
    const tab = new QueueSnapshotTab(queue);
    await queue.enqueue(ev("x"), { mutationId: "X" });
    await queue.enqueueProcedure({ path: "p", input: {}, touches: [ref("p1"), ref("p2")] }, { mutationId: "P" });
    expect(tab.marks()).toEqual({
      pending: [{ id: "X", refs: [ref("x")] }, { id: "P", refs: [ref("p1"), ref("p2")] }],
      owed: [],
    });
  });

  it("en annan fliks post (inläst ur kön) märks inte: raderna finns inte i flikens minne", async () => {
    const { a, b } = await twoQueues();
    await a.enqueue(ev("x"), { mutationId: "X" });
    const tab = new QueueSnapshotTab(b);
    await tab.refresh();
    expect(b.has("X")).toBe(true);
    expect(tab.marks().pending).toEqual([]);
  });

  it("position: postens plats i kön, eller null", async () => {
    const queue = new MutationQueue();
    const tab = new QueueSnapshotTab(queue);
    await queue.enqueue(ev("x"), { mutationId: "X" });
    await queue.enqueue(ev("y"), { mutationId: "Y" });
    expect([tab.position("X"), tab.position("Y"), tab.position("Z")]).toEqual([0, 1, null]);
  });

  it("adopt: en märkt post som inte ligger i kön är avgjord — raderna läses om", async () => {
    const queue = new MutationQueue();
    await queue.enqueue(ev("x"), { mutationId: "X" });
    const tab = new QueueSnapshotTab(queue);
    tab.adopt({ pending: [{ id: "X", refs: [ref("x")] }, { id: "GONE", refs: [ref("g1"), ref("g2")] }], owed: [ref("o")] });
    expect(tab.marks()).toEqual({ pending: [{ id: "X", refs: [ref("x")] }], owed: [ref("o"), ref("g1"), ref("g2")] });
  });

  it("adopt: en köpost som snapshotet inte märkt finns inte i minnet och märks inte", async () => {
    const { a, b } = await twoQueues();
    await a.enqueue(ev("x"), { mutationId: "X" });
    await a.enqueue(ev("y"), { mutationId: "Y" });
    await b.refresh();
    const fresh = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence([...a.pending()]));
    const tab = new QueueSnapshotTab(fresh);
    tab.adopt({ pending: [{ id: "X", refs: [ref("x")] }], owed: [] });
    expect(tab.marks().pending.map((m) => m.id)).toEqual(["X"]);
  });

  it("adopt utan märken (före #1714): snapshotet antas bära köns rader", async () => {
    const queue = await MutationQueue.hydrate(new InMemoryMutationQueuePersistence());
    await queue.enqueue(ev("x"), { mutationId: "X" });
    const tab = new QueueSnapshotTab(queue);
    tab.adopt(null);
    expect(tab.marks()).toEqual({ pending: [{ id: "X", refs: [ref("x")] }], owed: [] });
  });

  it("bind lämnar över raderna som väntat sedan hydreringen till motorn", () => {
    const tab = new QueueSnapshotTab(new MutationQueue());
    tab.adopt({ pending: [], owed: [ref("o")] });
    const engine = fakeEngine();
    tab.bind(engine);
    expect(engine.refs).toEqual([ref("o")]);
    // Raderna står kvar i märkena tills motorn har läst om dem.
    expect(tab.marks().owed).toEqual([ref("o")]);
    engine.refs.length = 0;
    expect(tab.marks().owed).toEqual([]);
  });

  it("en post som en annan flik kvitterat: dess rader läses om, och märks som det", async () => {
    const { a, b } = await twoQueues();
    await b.enqueue(ev("x"), { mutationId: "X" });
    const tab = new QueueSnapshotTab(b);
    const engine = fakeEngine();
    tab.bind(engine);
    await a.refresh();
    await a.ack("X");
    await tab.refresh();
    expect(tab.marks()).toEqual({ pending: [], owed: [ref("x")] });
    expect(engine.refs).toEqual([ref("x")]);
  });
});
