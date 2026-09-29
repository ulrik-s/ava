/**
 * Ett jobb som hänger får aldrig blockera sin kind (#1286).
 *
 * Förut höll ett avbrutet jobb kindens plats tills workern returnerade. En
 * worker som ignorerade AbortSignal, eller hängde på ett nätanrop utan
 * signal (Graph i mirror-to-outlook), stod då kvar som "running", och alla
 * följande jobb av samma kind blev kvar som "queued" tills fliken laddades
 * om.
 *
 * Nu gäller:
 *   - Avbryt släpper platsen direkt: jobbet blir "canceled" och nästa jobb
 *     startar. Workerns sena resultat ignoreras.
 *   - En kind kan ha en tidsgräns. Ett jobb som når den blir "failed" med
 *     ett tydligt fel, och platsen släpps.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { createJobQueue, type Job, type JobQueue } from "@/lib/client/jobs/job-queue";

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
const hang = (): Promise<void> => new Promise<void>(() => {});

let q: JobQueue;
let restoreWarn = (): void => {};
const statusOf = (id: string): Job["status"] | undefined => q.list().find((j) => j.id === id)?.status;
const jobOf = (id: string): Job | undefined => q.list().find((j) => j.id === id);

/** En worker vars utgång testet styr — för att släppa den EFTER avbrottet. */
function controllable(): { worker: () => Promise<void>; resolve: () => void; reject: (e: Error) => void } {
  let res = (): void => {};
  let rej = (_e: Error): void => {};
  return {
    worker: () => new Promise<void>((r, j) => { res = r; rej = j; }),
    resolve: () => { res(); },
    reject: (e) => { rej(e); },
  };
}

beforeEach(() => {
  // Lång vakt-tid: vakten har egna tester (job-queue-diagnostics).
  q = createJobQueue({ cancelStallWarnMs: 60_000 });
  const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
  restoreWarn = () => { spy.mockRestore(); };
});
afterEach(() => { restoreWarn(); });

describe("avbryt ett jobb som kör (#1286)", () => {
  it("jobbet blir 'canceled' direkt, även om workern aldrig returnerar", () => {
    q.registerWorker("custom", hang);
    const id = q.enqueue("custom", "Hänger");
    q.cancel(id);
    expect(statusOf(id)).toBe("canceled");
    expect(jobOf(id)?.finishedAt).toBeGreaterThan(0);
  });

  it("nästa jobb av samma kind startar direkt", () => {
    q.registerWorker("custom", hang);
    const hung = q.enqueue("custom", "Hänger");
    const next = q.enqueue("custom", "Nästa");
    expect(statusOf(next)).toBe("queued");
    q.cancel(hung);
    expect(statusOf(next)).toBe("running");
  });

  it("workern får avbrottssignalen", () => {
    let signal: AbortSignal | null = null;
    q.registerWorker("custom", (_p, ctx) => { signal = ctx.signal; return hang(); });
    const id = q.enqueue("custom", "Hänger");
    q.cancel(id);
    expect(signal).not.toBeNull();
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
  });

  it("workerns sena lyckade resultat ignoreras — jobbet förblir 'canceled'", async () => {
    const c = controllable();
    q.registerWorker("custom", c.worker);
    const id = q.enqueue("custom", "Sen");
    q.cancel(id);
    c.resolve();
    await sleep(5);
    expect(statusOf(id)).toBe("canceled");
    expect(jobOf(id)?.progress).toBeUndefined();
  });

  it("workerns sena fel ignoreras — jobbet blir inte 'failed'", async () => {
    const c = controllable();
    q.registerWorker("custom", c.worker);
    const id = q.enqueue("custom", "Sen");
    q.cancel(id);
    c.reject(new Error("nätfel efteråt"));
    await sleep(5);
    expect(statusOf(id)).toBe("canceled");
    expect(jobOf(id)?.error).toBeUndefined();
  });

  it("sen setProgress från en övergiven worker ändrar inte jobbet", () => {
    let report = (_p: number): void => {};
    q.registerWorker("custom", (_p, ctx) => { report = ctx.setProgress; return hang(); });
    const id = q.enqueue("custom", "Sen");
    q.cancel(id);
    report(0.5);
    expect(jobOf(id)?.progress).toBeUndefined();
  });

  it("den övergivna workerns avslut släpper inte platsen för nästa jobb", async () => {
    const runs: Array<() => void> = [];
    q.registerWorker("custom", () => new Promise<void>((r) => { runs.push(r); }));
    const first = q.enqueue("custom", "Första");
    q.cancel(first);
    const second = q.enqueue("custom", "Andra");
    const third = q.enqueue("custom", "Tredje");
    expect(statusOf(second)).toBe("running");
    // Den första workern returnerar till slut — det får inte starta ett tredje jobb parallellt.
    runs[0]?.();
    await sleep(5);
    expect(statusOf(second)).toBe("running");
    expect(statusOf(third)).toBe("queued");
  });

  it("'Försök igen' på ett avbrutet jobb kör en ny körning; den gamla workerns avslut påverkar den inte", async () => {
    const runs: Array<() => void> = [];
    q.registerWorker("custom", () => new Promise<void>((r) => { runs.push(r); }));
    const id = q.enqueue("custom", "Igen");
    q.cancel(id);
    q.retry(id);
    expect(statusOf(id)).toBe("running");
    runs[0]?.(); // den övergivna körningen returnerar
    await sleep(5);
    expect(statusOf(id)).toBe("running");
    runs[1]?.(); // den nya körningen returnerar
    await sleep(5);
    expect(statusOf(id)).toBe("done");
  });

  it("en worker som själv kastar AbortError (utan att ha avbrutits) → 'canceled'", async () => {
    q.registerWorker("custom", async () => { throw new DOMException("Avbrutet", "AbortError"); });
    const id = q.enqueue("custom", "Avbryter sig själv");
    await sleep(5);
    expect(statusOf(id)).toBe("canceled");
  });

  it("avbryt ett klart jobb → ingen ändring", async () => {
    q.registerWorker("custom", async () => {});
    const id = q.enqueue("custom", "Klar");
    await sleep(5);
    q.cancel(id);
    expect(statusOf(id)).toBe("done");
  });

  it("avbryt ett okänt id → ingenting händer", () => {
    expect(() => { q.cancel("finns-inte"); }).not.toThrow();
  });
});

describe("tidsgräns per kind (#1286)", () => {
  it("ett jobb som når tidsgränsen blir 'failed' med ett tydligt fel", async () => {
    q.registerWorker("custom", hang, { timeoutMs: 30 });
    const id = q.enqueue("custom", "Hänger");
    await sleep(80);
    expect(statusOf(id)).toBe("failed");
    expect(jobOf(id)?.error).toMatch(/Tidsgränsen på 30 ms överskreds/);
  });

  it("tidsgränsen avbryter workern och släpper platsen för nästa jobb", async () => {
    let signal: AbortSignal | null = null;
    q.registerWorker("custom", (_p, ctx) => { signal ??= ctx.signal; return hang(); }, { timeoutMs: 30 });
    q.enqueue("custom", "Hänger");
    const next = q.enqueue("custom", "Nästa");
    await sleep(50);
    expect((signal as AbortSignal | null)?.aborted).toBe(true);
    expect(statusOf(next)).toBe("running");
  });

  it("tidsgränsen anges i sekunder när den är minst en sekund", async () => {
    vi.useFakeTimers();
    try {
      q.registerWorker("custom", hang, { timeoutMs: 60_000 });
      const id = q.enqueue("custom", "Graph hänger");
      vi.advanceTimersByTime(60_001);
      expect(jobOf(id)?.error).toMatch(/Tidsgränsen på 60 s överskreds/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ett jobb som blir klart i tid → 'done', och tidsgränsen slår inte till efteråt", async () => {
    q.registerWorker("custom", async () => { await sleep(5); }, { timeoutMs: 40 });
    const id = q.enqueue("custom", "Snabb");
    await sleep(80);
    expect(statusOf(id)).toBe("done");
    expect(jobOf(id)?.error).toBeUndefined();
  });

  it("ett avbrutet jobb får inte också tidsgränsens fel", async () => {
    q.registerWorker("custom", hang, { timeoutMs: 30 });
    const id = q.enqueue("custom", "Avbryts");
    q.cancel(id);
    await sleep(60);
    expect(statusOf(id)).toBe("canceled");
    expect(jobOf(id)?.error).toBeUndefined();
  });

  it("kind utan tidsgräns → inget tidsfel, jobbet kör vidare", async () => {
    q.registerWorker("custom", hang);
    const id = q.enqueue("custom", "Långsam");
    await sleep(60);
    expect(statusOf(id)).toBe("running");
  });

  it("ny registrering utan tidsgräns tar bort en tidigare tidsgräns", async () => {
    q.registerWorker("custom", hang, { timeoutMs: 20 });
    q.registerWorker("custom", hang);
    const id = q.enqueue("custom", "Utan gräns");
    await sleep(50);
    expect(statusOf(id)).toBe("running");
  });
});
