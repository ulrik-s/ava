/**
 * LocalStorePersistence (#412) — InMemoryPersistence + createPersistedLocalStore:
 * hydrering ur persistensen, seed-fallback, och write-back av hela källan efter
 * mutation (snapshot-baserad; mutations-kön kommer i #413).
 */

import { describe, it, expect } from "vitest-compat";
import type { Delegate } from "@/lib/server/data-store/IDataStore";
import {
  InMemoryPersistence,
  createPersistedLocalStore,
} from "@/lib/server/data-store/in-memory/local-store-persistence";

const loose = (d: unknown): Delegate => d as unknown as Delegate;

describe("InMemoryPersistence", () => {
  it("hydrate på tom persistens → null", async () => {
    expect(await new InMemoryPersistence().hydrate()).toBeNull();
  });

  it("save → hydrate round-trippar (djupkopia, ej delad referens)", async () => {
    const p = new InMemoryPersistence();
    const src = { users: [{ id: "u1", name: "Anna" }] };
    await p.save(src);
    const out = await p.hydrate();
    expect(out?.users).toEqual([{ id: "u1", name: "Anna" }]);
    expect(out).not.toBe(src); // djupkopia
  });
});

describe("createPersistedLocalStore", () => {
  it("hydrerar källan ur persistensen", async () => {
    const store = await createPersistedLocalStore(
      new InMemoryPersistence({ users: [{ id: "u1", name: "Anna" }] }),
    );
    expect(await store.users.findFirst({ where: { id: "u1" } })).toMatchObject({ name: "Anna" });
  });

  it("faller tillbaka på seed när inget persisterat", async () => {
    const store = await createPersistedLocalStore(new InMemoryPersistence(), {
      users: [{ id: "s1", name: "Seed" }],
    });
    expect(await store.users.findFirst({ where: { id: "s1" } })).toMatchObject({ name: "Seed" });
  });

  it("skriver tillbaka hela källan efter mutation (ny store ser ändringen)", async () => {
    const p = new InMemoryPersistence({ users: [] });
    const store = await createPersistedLocalStore(p);
    await loose(store.users).create({ data: { id: "u1", name: "Anna" } });

    const reopened = await createPersistedLocalStore(p);
    expect(await reopened.users.findFirst({ where: { id: "u1" } })).toMatchObject({ name: "Anna" });
  });
});
