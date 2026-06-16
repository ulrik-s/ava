/**
 * LocalStore-kärnan (#412) — den generiska in-memory-motorn som bröts ut ur
 * DemoDataStore. Engine-detaljerna täcks brett av demo-data-store-testerna;
 * här verifieras den nya ytan: read-only vs writable, `currentSource`-gettern
 * och transaktions-rollback direkt mot LocalStore.
 */

import { describe, it, expect, vi } from "vitest-compat";
import type { Delegate } from "@/lib/server/data-store/IDataStore";
import { LocalStore } from "@/lib/server/data-store/in-memory/local-store";

// Lös delegat-vy för att kringgå de branded id-typerna (UserId) i testdata.
const loose = (d: unknown): Delegate => d as unknown as Delegate;

describe("LocalStore", () => {
  it("read-only: läser källan, mutation kastar, currentSource är samma referens", async () => {
    const source = { users: [{ id: "u1", name: "Anna" }] };
    const store = new LocalStore(source);
    expect(await store.users.findFirst({ where: { id: "u1" } })).toMatchObject({ name: "Anna" });
    expect(store.currentSource).toBe(source);
    await expect(loose(store.users).create({ data: { id: "u2", name: "B" } })).rejects.toThrow();
  });

  it("writable: create muterar källan + triggar onMutate", async () => {
    const onMutate = vi.fn();
    const store = new LocalStore({ users: [] }, onMutate);
    await loose(store.users).create({ data: { id: "u1", name: "Anna" } });
    expect(onMutate).toHaveBeenCalledTimes(1);
    expect(store.currentSource.users).toHaveLength(1);
  });

  it("transaction: rullar tillbaka källan vid fel och flushar ingen write-back", async () => {
    const onMutate = vi.fn();
    const store = new LocalStore({ users: [] }, onMutate);
    await expect(
      store.transaction(async (tx) => {
        await loose(tx.users).create({ data: { id: "u1", name: "Anna" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(store.currentSource.users).toHaveLength(0);
    expect(onMutate).not.toHaveBeenCalled();
  });

  it("transaction: commit flushar buffrade write-back-event en gång var", async () => {
    const onMutate = vi.fn();
    const store = new LocalStore({ users: [] }, onMutate);
    await store.transaction(async (tx) => {
      await loose(tx.users).create({ data: { id: "u1", name: "Anna" } });
      await loose(tx.users).create({ data: { id: "u2", name: "Bo" } });
    });
    expect(onMutate).toHaveBeenCalledTimes(2);
    expect(store.currentSource.users).toHaveLength(2);
  });
});
