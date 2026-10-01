/**
 * `PendingWrites` (#1386) — räknaren för lokala skrivningar som ännu inte nått
 * IndexedDB. Sidan varnar för omladdning bara medan den är upptagen.
 */

import { describe, it, expect } from "vitest-compat";
import { PendingWrites } from "@/lib/server/data-store/in-memory/pending-writes";

describe("PendingWrites", () => {
  it("upptagen under skrivningen, ledig efteråt; meddelar bara vid lägesbyte", async () => {
    const writes = new PendingWrites();
    const changes: boolean[] = [];
    writes.subscribe((busy) => changes.push(busy));
    let release: () => void = () => undefined;
    const first = writes.track(() => new Promise<string>((resolve) => { release = () => resolve("klar"); }));
    const second = writes.track(async () => 2);
    expect(writes.busy()).toBe(true);
    expect(await second).toBe(2);
    expect(writes.busy()).toBe(true); // den första pågår fortfarande
    release();
    expect(await first).toBe("klar");
    expect(writes.busy()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("en skrivning som kastar räknas av; avregistrerad lyssnare hör inget", async () => {
    const writes = new PendingWrites();
    const changes: boolean[] = [];
    const unsubscribe = writes.subscribe((busy) => changes.push(busy));
    await expect(writes.track(() => Promise.reject(new Error("full disk")))).rejects.toThrow("full disk");
    expect(writes.busy()).toBe(false);
    unsubscribe();
    await writes.track(async () => undefined);
    expect(changes).toEqual([true, false]);
  });
});
