/**
 * `MutationLock` (#1265, #1794) — in-process-länken kör alla mutationer
 * exklusivt: en i taget, i ordning, och ett fel släpper låset.
 */
import { describe, expect, it } from "vitest-compat";
import { MutationLock } from "@/lib/client/demo/mutation-lock";

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe("MutationLock", () => {
  it("exklusiva körs en i taget, i ordning", async () => {
    const lock = new MutationLock();
    const events: string[] = [];
    await Promise.all([
      lock.exclusive(async () => { await tick(); events.push("1"); }),
      lock.exclusive(() => { events.push("2"); return Promise.resolve(); }),
    ]);
    expect(events).toEqual(["1", "2"]);
  });

  it("ett fel släpper låset och bubblar till rätt anropare", async () => {
    const lock = new MutationLock();
    await expect(lock.exclusive(() => Promise.reject(new Error("fel")))).rejects.toThrow("fel");
    await expect(lock.exclusive(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("en som kastar körs ändå i ordning före nästa", async () => {
    const lock = new MutationLock();
    const events: string[] = [];
    const a = lock.exclusive(async () => { await tick(); events.push("a"); throw new Error("a"); });
    const b = lock.exclusive(() => { events.push("b"); return Promise.resolve(); });
    await expect(a).rejects.toThrow("a");
    await b;
    expect(events).toEqual(["a", "b"]);
  });
});
