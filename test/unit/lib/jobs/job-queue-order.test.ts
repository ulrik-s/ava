/**
 * Jobbkön kör jobb i den ordning de köades — FIFO (#1287).
 *
 * Buggen: `enqueue` lägger nya jobb först i listan (så att /jobs visar de
 * nyaste överst), och `pump` tog det första köade jobbet i listan, alltså det
 * SENAST köade. Fyra jobb körde som 1, 4, 3, 2. Vid en batchuppladdning
 * analyserades dokumenten baklänges, och för Outlook-speglingen kunde en
 * delete köras före en upsert av samma event.
 */
import { beforeEach, describe, expect, it } from "vitest-compat";
import { createJobQueue, type JobQueue } from "@/lib/client/jobs/job-queue";

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });

let q: JobQueue;
/** Etiketterna i den ordning workern startade dem. */
let started: string[] = [];
/** Släpp det jobb som kör just nu (workern väntar tills testet släpper den). */
let releases: Array<() => void> = [];

beforeEach(() => {
  q = createJobQueue();
  started = [];
  releases = [];
  const gated = (payload: Record<string, unknown>): Promise<void> => {
    started.push(String(payload.n));
    return new Promise<void>((r) => { releases.push(r); });
  };
  q.registerWorker("custom", gated);
  q.registerWorker("index-document", gated);
});

/** Släpp jobben ett i taget tills inget mer startar. */
async function drain(): Promise<void> {
  for (let i = 0; i < 20 && releases.length > 0; i++) {
    releases.shift()?.();
    await sleep(1);
  }
}

describe("jobbkön är FIFO per kind (#1287)", () => {
  it("fyra jobb av samma kind körs i den ordning de köades", async () => {
    for (const n of [1, 2, 3, 4]) q.enqueue("custom", `J${n}`, { n });
    await drain();
    expect(started).toEqual(["1", "2", "3", "4"]);
  });

  it("många jobb (en batchuppladdning) körs i ordning", async () => {
    const ns = Array.from({ length: 12 }, (_, i) => i + 1);
    for (const n of ns) q.enqueue("custom", `J${n}`, { n });
    await drain();
    expect(started).toEqual(ns.map(String));
  });

  it("jobb som köas medan kön arbetar hamnar sist", async () => {
    q.enqueue("custom", "J1", { n: 1 });
    q.enqueue("custom", "J2", { n: 2 });
    releases.shift()?.(); // J1 klar → J2 startar
    await sleep(1);
    q.enqueue("custom", "J3", { n: 3 });
    q.enqueue("custom", "J4", { n: 4 });
    await drain();
    expect(started).toEqual(["1", "2", "3", "4"]);
  });

  it("'Försök igen' ställer jobbet sist i kön, inte före dem som väntar", async () => {
    let fail = true;
    q.registerWorker("custom", async (payload) => {
      started.push(String(payload.n));
      if (payload.n === 0 && fail) { fail = false; throw new Error("första försöket"); }
      await new Promise<void>((r) => { releases.push(r); });
    });
    const x = q.enqueue("custom", "X", { n: 0 });
    await sleep(1); // X misslyckas
    q.enqueue("custom", "A", { n: 1 }); // A kör
    q.enqueue("custom", "B", { n: 2 }); // B väntar
    q.retry(x); // X köas om — efter B
    await drain();
    expect(started).toEqual(["0", "1", "2", "0"]);
  });

  it("varje kind har sin egen ordning, och en upptagen kind blockerar inte en annan", async () => {
    q.enqueue("custom", "C1", { n: "c1" });
    q.enqueue("custom", "C2", { n: "c2" });
    q.enqueue("index-document", "I1", { n: "i1" });
    q.enqueue("index-document", "I2", { n: "i2" });
    // C1 och I1 kör parallellt (olika kinds); C2 och I2 väntar.
    expect(started).toEqual(["c1", "i1"]);
    await drain();
    expect(started.filter((s) => s.startsWith("c"))).toEqual(["c1", "c2"]);
    expect(started.filter((s) => s.startsWith("i"))).toEqual(["i1", "i2"]);
  });

  it("ett avbrutet köat jobb hoppas över — ordningen för resten består", async () => {
    q.enqueue("custom", "J1", { n: 1 });
    const j2 = q.enqueue("custom", "J2", { n: 2 });
    q.enqueue("custom", "J3", { n: 3 });
    q.cancel(j2);
    await drain();
    expect(started).toEqual(["1", "3"]);
  });

  it("listan (/jobs) visar fortfarande de nyaste överst", () => {
    q.enqueue("custom", "Först", { n: 1 });
    q.enqueue("custom", "Sist", { n: 2 });
    expect(q.list().map((j) => j.label)).toEqual(["Sist", "Först"]);
  });
});
