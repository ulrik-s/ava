/**
 * `SharedExclusiveLock` (#1265) — köbara procedurer körs exklusivt (deras
 * lokala skrivningar attribueras till anropet), övriga mutationer delat: de
 * får fortsätta överlappa varandra som förut, men aldrig en exklusiv.
 */
import { describe, expect, it } from "vitest-compat";
import { SharedExclusiveLock } from "@/lib/client/demo/shared-exclusive-lock";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe("SharedExclusiveLock", () => {
  it("delade uppgifter överlappar varandra", async () => {
    const lock = new SharedExclusiveLock();
    const gate = deferred();
    const started: string[] = [];
    const a = lock.shared(async () => { started.push("a"); await gate.promise; });
    const b = lock.shared(async () => { started.push("b"); await gate.promise; });
    await tick();
    expect(started).toEqual(["a", "b"]);
    gate.resolve();
    await Promise.all([a, b]);
  });

  it("en exklusiv väntar tills pågående delade är klara", async () => {
    const lock = new SharedExclusiveLock();
    const gate = deferred();
    const events: string[] = [];
    const s = lock.shared(async () => { await gate.promise; events.push("delad klar"); });
    await tick();
    const x = lock.exclusive(async () => { events.push("exklusiv"); });
    await tick();
    expect(events).toEqual([]);
    gate.resolve();
    await Promise.all([s, x]);
    expect(events).toEqual(["delad klar", "exklusiv"]);
  });

  it("en delad som kommer efter en väntande exklusiv väntar på den", async () => {
    const lock = new SharedExclusiveLock();
    const gate = deferred();
    const events: string[] = [];
    const x = lock.exclusive(async () => { await gate.promise; events.push("exklusiv"); });
    const s = lock.shared(async () => { events.push("delad"); });
    await tick();
    expect(events).toEqual([]);
    gate.resolve();
    await Promise.all([x, s]);
    expect(events).toEqual(["exklusiv", "delad"]);
  });

  it("exklusiva körs en i taget, i ordning", async () => {
    const lock = new SharedExclusiveLock();
    const events: string[] = [];
    await Promise.all([
      lock.exclusive(async () => { await tick(); events.push("1"); }),
      lock.exclusive(async () => { events.push("2"); }),
    ]);
    expect(events).toEqual(["1", "2"]);
  });

  it("ett fel släpper låset och bubblar till rätt anropare", async () => {
    const lock = new SharedExclusiveLock();
    await expect(lock.exclusive(async () => { throw new Error("fel"); })).rejects.toThrow("fel");
    await expect(lock.shared(async () => "ok")).resolves.toBe("ok");
    await expect(lock.shared(async () => { throw new Error("delat fel"); })).rejects.toThrow("delat fel");
    await expect(lock.exclusive(async () => "ok")).resolves.toBe("ok");
  });
});
