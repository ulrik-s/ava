/**
 * Diagnostik för jobbkön (#1283, #1286): vem håller en kinds plats, hur länge,
 * och vilka workers som övergetts (avbrutna eller över tidsgränsen) utan att
 * ha returnerat.
 *
 * Bakgrund: testet "cancel av running jobb" föll i CI med "aldrig running
 * (är queued)". Ett avbrutet jobb höll kindens plats tills workern
 * returnerade, och en worker som ignorerade AbortSignal blockerade då alla
 * följande jobb av samma kind. Sedan #1286 släpps platsen direkt, och den
 * övergivna workern syns i diagnostiken och i en konsolvarning.
 *
 * Varje test använder en egen kö (`createJobQueue`), så att singletonen inte
 * läcker tillstånd mellan testerna.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest-compat";
import { createJobQueue, formatDiagnostics, type JobQueue } from "@/lib/client/jobs/job-queue";

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
/** En worker som aldrig returnerar och ignorerar avbrott (t.ex. ett nätanrop utan signal). */
const hang = (): Promise<void> => new Promise<void>(() => {});
/** En worker som respekterar avbrott. */
const untilAborted = (_p: unknown, ctx: { signal: AbortSignal }): Promise<void> =>
  new Promise<void>((_, reject) => { ctx.signal.addEventListener("abort", () => { reject(new Error("aborted")); }); });

let q: JobQueue;
/** Allt som skrivits med console.warn i testet. */
let warned: string[] = [];
let restoreWarn = (): void => {};
/** Varningar som gäller jobbet med etiketten (vakter från tidigare testers köar kan slå till här). */
const warningsFor = (label: string): string[] => warned.filter((m) => m.includes(`"${label}"`));

beforeEach(() => {
  q = createJobQueue({ cancelStallWarnMs: 40 });
  warned = [];
  const spy = vi.spyOn(console, "warn").mockImplementation((m: unknown) => { warned.push(String(m)); });
  restoreWarn = () => { spy.mockRestore(); };
});
afterEach(() => { restoreWarn(); });

describe("jobQueue.diagnose()", () => {
  it("tom kö → inga kinds", () => {
    expect(q.diagnose()).toEqual([]);
  });

  it("ett jobb som kör → kinden hålls av det, ingen väntar, inget övergivet", () => {
    q.registerWorker("custom", hang);
    const id = q.enqueue("custom", "Kör");
    const [d] = q.diagnose();
    expect(d).toMatchObject({ kind: "custom", queued: 0, oldestQueuedWaitMs: null, abandoned: [] });
    expect(d?.holder).toMatchObject({ id, label: "Kör" });
    expect(d?.holder?.runningForMs).toBeGreaterThanOrEqual(0);
  });

  it("jobb som väntar bakom det som kör räknas, med väntetid för det äldsta", async () => {
    q.registerWorker("custom", hang);
    q.enqueue("custom", "Kör");
    q.enqueue("custom", "Väntar 1");
    await sleep(15);
    q.enqueue("custom", "Väntar 2");
    const [d] = q.diagnose();
    expect(d?.queued).toBe(2);
    expect(d?.oldestQueuedWaitMs).toBeGreaterThanOrEqual(10);
  });

  it("varje kind redovisas för sig", () => {
    q.registerWorker("custom", hang);
    q.registerWorker("index-document", hang);
    q.enqueue("custom", "A");
    q.enqueue("index-document", "B");
    expect(q.diagnose().map((d) => d.kind).sort()).toEqual(["custom", "index-document"]);
  });

  it("avbrutet jobb vars worker inte returnerar → platsen släpps, workern syns som övergiven", async () => {
    q.registerWorker("custom", hang);
    const id = q.enqueue("custom", "Hänger");
    q.cancel(id);
    const next = q.enqueue("custom", "Nästa");
    await sleep(10);
    const [d] = q.diagnose();
    expect(d?.holder?.id).toBe(next);
    expect(d?.queued).toBe(0);
    expect(d?.abandoned).toHaveLength(1);
    expect(d?.abandoned[0]).toMatchObject({ id, label: "Hänger" });
    expect(d?.abandoned[0]?.abandonedForMs).toBeGreaterThanOrEqual(5);
  });

  it("en övergiven worker som till slut returnerar försvinner ur diagnostiken", async () => {
    let finish = (): void => {};
    q.registerWorker("custom", () => new Promise<void>((r) => { finish = r; }));
    const id = q.enqueue("custom", "Sen");
    q.cancel(id);
    expect(q.diagnose()[0]?.abandoned).toHaveLength(1);
    finish();
    await sleep(5);
    expect(q.diagnose()).toEqual([]);
  });

  it("klara jobb syns inte — kinden är ledig", async () => {
    q.registerWorker("custom", async () => {});
    q.enqueue("custom", "Snabb");
    await sleep(5);
    expect(q.diagnose()).toEqual([]);
  });
});

describe("vakt: övergiven worker som inte returnerar", () => {
  it("varnar i konsolen, en gång, med kind och jobb — och säger att kön inte är blockerad", async () => {
    q.registerWorker("custom", hang);
    const id = q.enqueue("custom", "Hänger på Graph");
    q.cancel(id);
    await sleep(120);
    const warnings = warningsFor("Hänger på Graph");
    expect(warnings).toHaveLength(1);
    const msg = warnings[0] ?? "";
    expect(msg).toContain("'custom'");
    expect(msg).toMatch(/har inte returnerat/);
    expect(msg).toMatch(/kön är inte blockerad/);
  });

  it("worker som respekterar avbrottet → ingen varning", async () => {
    q.registerWorker("custom", untilAborted);
    const id = q.enqueue("custom", "Snäll");
    q.cancel(id);
    await sleep(80);
    expect(warningsFor("Snäll")).toEqual([]);
    expect(q.list().find((j) => j.id === id)?.status).toBe("canceled");
  });

  it("avbrutet köat jobb (körde aldrig) → ingen varning", async () => {
    q.registerWorker("custom", hang);
    q.enqueue("custom", "Kör vidare");
    const queued = q.enqueue("custom", "Köad");
    q.cancel(queued);
    await sleep(80);
    expect(warningsFor("Köad")).toEqual([]);
    expect(warningsFor("Kör vidare")).toEqual([]);
  });

  it("dubbla avbrott startar inte två vakter", async () => {
    q.registerWorker("custom", hang);
    const id = q.enqueue("custom", "Avbryts två gånger");
    q.cancel(id);
    q.cancel(id);
    await sleep(120);
    expect(warningsFor("Avbryts två gånger")).toHaveLength(1);
  });
});

describe("formatDiagnostics()", () => {
  it("tom kö → säger det", () => {
    expect(formatDiagnostics([])).toBe("jobbkön: inga aktiva kinds");
  });

  it("en rad per kind: vem som kör, hur länge, kö och övergivna workers", () => {
    const s = formatDiagnostics([
      { kind: "custom", holder: { id: "job-1", label: "Kör", runningForMs: 1200 }, queued: 2, oldestQueuedWaitMs: 900,
        abandoned: [{ id: "job-0", label: "Hänger", abandonedForMs: 800 }] },
      { kind: "sync", holder: { id: "job-2", label: "Synk", runningForMs: 50 }, queued: 0, oldestQueuedWaitMs: null, abandoned: [] },
    ]);
    expect(s).toContain("custom: kör job-1 \"Kör\" i 1200 ms; 2 väntar (äldsta 900 ms); övergivna: job-0 \"Hänger\" för 800 ms sedan");
    expect(s).toContain("sync: kör job-2 \"Synk\" i 50 ms; 0 väntar");
    expect(s).not.toContain("sync: kör job-2 \"Synk\" i 50 ms; 0 väntar;");
  });

  it("jobb som väntar utan att något kör (ska aldrig hända) syns tydligt", () => {
    expect(formatDiagnostics([{ kind: "custom", holder: null, queued: 1, oldestQueuedWaitMs: 30, abandoned: [] }]))
      .toContain("custom: INGET kör; 1 väntar (äldsta 30 ms)");
  });
});
