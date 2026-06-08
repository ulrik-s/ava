/**
 * Tester för `WritableDelegate` — basic CRUD + getter-baserad collection.
 */

import { describe, it, expect, vi } from "vitest-compat";
import { WritableDelegate, type MutationEvent } from "@/lib/server/data-store/in-memory/writable-delegate";

interface Matter extends Record<string, unknown> {
  id: string;
  title: string;
  organizationId: string;
}

function makeDelegate(initial: Matter[] = [], onMutate?: (e: MutationEvent<Matter>) => void) {
  const box = { items: [...initial] };
  return {
    box,
    delegate: new WritableDelegate<Matter>({
      entity: "matter",
      collection: () => box.items,
      ...(onMutate !== undefined ? { onMutate } : {}),
    }),
  };
}

describe("WritableDelegate", () => {
  it("create lägger till row + triggar onMutate", async () => {
    const onMutate = vi.fn();
    const { box, delegate } = makeDelegate([], onMutate);
    const result = await delegate.create({ data: { id: "m1", title: "Avtal", organizationId: "o1" } });
    expect((result as Matter).id).toBe("m1");
    expect(box.items).toHaveLength(1);
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "create", entity: "matter" }));
  });

  it("create utan id genererar ett", async () => {
    const { delegate } = makeDelegate([]);
    const row = await delegate.create({ data: { title: "Utan ID", organizationId: "o1" } });
    expect((row as Matter).id).toBeTruthy();
    expect((row as Matter).id.length).toBeGreaterThan(3);
  });

  it("update muterar befintlig row", async () => {
    const initial: Matter[] = [{ id: "m1", title: "Gammal", organizationId: "o1" }];
    const onMutate = vi.fn();
    const { box, delegate } = makeDelegate(initial, onMutate);
    await delegate.update({ where: { id: "m1" }, data: { title: "Ny" } });
    expect(box.items[0]!.title).toBe("Ny");
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "update" }));
  });

  it("update på okänt id kastar", async () => {
    const { delegate } = makeDelegate([]);
    await expect(delegate.update({ where: { id: "missing" }, data: { title: "X" } })).rejects.toThrow();
  });

  it("delete tar bort row", async () => {
    const initial: Matter[] = [{ id: "m1", title: "X", organizationId: "o1" }];
    const onMutate = vi.fn();
    const { box, delegate } = makeDelegate(initial, onMutate);
    await delegate.delete({ where: { id: "m1" } });
    expect(box.items).toHaveLength(0);
    expect(onMutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "delete" }));
  });

  it("delete på okänt id kastar", async () => {
    const { delegate } = makeDelegate([]);
    await expect(delegate.delete({ where: { id: "missing" } })).rejects.toThrow(/Hittade inte/);
  });

  it("findMany ser ny data efter create", async () => {
    const { delegate } = makeDelegate([]);
    await delegate.create({ data: { id: "m1", title: "A", organizationId: "o1" } });
    await delegate.create({ data: { id: "m2", title: "B", organizationId: "o1" } });
    const all = await delegate.findMany({});
    expect((all as Matter[]).map((m) => m.id).sort()).toEqual(["m1", "m2"]);
  });

  it("getter-baserad collection: byt ut array-referens vid run-time", async () => {
    // Detta är regressions-testet för bugen: DataStore byter ut
    // source-array via mergeSource → delegate måste se nya datan.
    const box = { items: [] as Matter[] };
    const delegate = new WritableDelegate<Matter>({
      entity: "matter",
      collection: () => box.items,
    });
    // Byt ut hela array:n (som mergeSource gör)
    box.items = [{ id: "fresh", title: "Loaded", organizationId: "o1" }];
    const all = await delegate.findMany({});
    expect((all as Matter[])).toHaveLength(1);
    expect((all as Matter[])[0]!.title).toBe("Loaded");

    // Mutation efter byte muterar nya array:n
    await delegate.create({ data: { id: "m2", title: "Added after", organizationId: "o1" } });
    expect(box.items).toHaveLength(2);
  });
});
