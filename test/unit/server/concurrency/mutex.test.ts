/**
 * Enhetstester för `Mutex` (#83, ADR 0013 beslut A) — FIFO-serialisering,
 * resultat-/fel-propagering och att låset släpps även vid kast.
 */
import { describe, it, expect } from "vitest-compat";
import { Mutex } from "@/lib/server/concurrency/mutex";

const tick = () => new Promise((r) => setTimeout(r, 5));

describe("Mutex", () => {
  it("returnerar fn:s resultat", async () => {
    const m = new Mutex();
    expect(await m.runExclusive(() => 42)).toBe(42);
    expect(await m.runExclusive(async () => "x")).toBe("x");
  });

  it("serialiserar överlappande anrop (ingen interleaving)", async () => {
    const m = new Mutex();
    const events: string[] = [];
    const job = (id: string) => m.runExclusive(async () => {
      events.push(`${id}:start`);
      await tick();
      events.push(`${id}:end`);
    });
    // Starta tre samtidigt — de ska köras strikt en i taget, i anropsordning.
    await Promise.all([job("a"), job("b"), job("c")]);
    expect(events).toEqual([
      "a:start", "a:end", "b:start", "b:end", "c:start", "c:end",
    ]);
  });

  it("ett kast släpper låset så nästa väntare kör, och propagerar till anroparen", async () => {
    const m = new Mutex();
    const order: string[] = [];
    const failing = m.runExclusive(async () => { order.push("boom"); throw new Error("nej"); });
    const next = m.runExclusive(async () => { order.push("efter"); return "ok"; });
    await expect(failing).rejects.toThrow("nej");
    expect(await next).toBe("ok");
    expect(order).toEqual(["boom", "efter"]);
  });
});
