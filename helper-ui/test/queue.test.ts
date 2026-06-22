/**
 * UploadQueue (ADR 0028 §3) — durabel offline-first upload-kö. Testar mot
 * en riktig temp-katalog (durabiliteten ÄR poängen) med injicerad nät/klocka
 * så drän-logiken blir deterministisk.
 */

import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import superjson from "superjson";

import { backoffMs, defaultQueueDeps, UploadQueue, type QueueDeps } from "../src/engine/queue.ts";

const dirs: string[] = [];
async function tmpDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "ava-queue-"));
  dirs.push(d);
  return d;
}
afterAll(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

interface UploadDocCall { document: { id: string; trpcUrl: string }; body: Uint8Array; auth?: string }

/** Injicerbara deps: räknande klocka + förutsägbara id:n + skript-styrd PUT + tRPC-upload. */
function fakeDeps(
  putStatuses: number[] | (() => Promise<number>),
  uploadDocFails = false,
): { deps: QueueDeps; puts: Array<{ url: string; body: Uint8Array; auth?: string }>; uploadDocs: UploadDocCall[]; tick: () => void } {
  let t = 1000;
  let n = 0;
  const puts: Array<{ url: string; body: Uint8Array; auth?: string }> = [];
  const uploadDocs: UploadDocCall[] = [];
  const put = async (url: string, body: Uint8Array, auth?: string): Promise<number> => {
    puts.push({ url, body, ...(auth !== undefined ? { auth } : {}) });
    if (typeof putStatuses === "function") return putStatuses();
    return putStatuses[Math.min(puts.length - 1, putStatuses.length - 1)] ?? 200;
  };
  const uploadDoc = async (document: { id: string; trpcUrl: string }, body: Uint8Array, auth?: string): Promise<void> => {
    uploadDocs.push({ document, body, ...(auth !== undefined ? { auth } : {}) });
    if (uploadDocFails) throw new Error("trpc boom");
  };
  return {
    deps: { now: () => t, newId: () => `id-${++n}`, put, uploadDoc },
    puts,
    uploadDocs,
    tick: () => { t += 10 * 60_000; }, // hoppa förbi all backoff
  };
}

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

describe("UploadQueue.enqueue", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("skriver bytes + manifest durabelt till disk", async () => {
    const { deps } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a.docx", bytes: bytes("hej") });

    const files = (await readdir(dir)).sort();
    expect(files).toEqual(["id-1.bin", "id-1.json"]);
    expect(q.snapshot()).toMatchObject({ pending: 1, conflict: 0, total: 1 });
  });

  test("sammanslår per uploadUrl (senaste-vinner, samma id)", async () => {
    const { deps } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a.docx", bytes: bytes("v1") });
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a.docx", bytes: bytes("v2-längre") });

    const files = (await readdir(dir)).filter((f) => f.endsWith(".bin"));
    expect(files).toEqual(["id-1.bin"]); // återanvänt id → ingen andra fil
    expect(q.snapshot().total).toBe(1);
  });

  test("snapshot döljer authHeader", async () => {
    const { deps } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x"), authHeader: "Bearer secret" });
    const entry = q.snapshot().entries[0]!;
    expect(entry).not.toHaveProperty("authHeader");
    expect(JSON.stringify(q.snapshot())).not.toContain("secret");
  });
});

describe("UploadQueue.peekByKey (ADR 0032 local-first)", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("returnerar köade bytes för dokumentet (osynkad lokal ändring)", async () => {
    const { deps } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ document: { id: "d1", trpcUrl: "x" }, fileName: "a.docx", bytes: bytes("EDIT") });
    const got = await q.peekByKey("doc:d1");
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!)).toBe("EDIT");
  });

  test("null när inget köat finns för nyckeln", async () => {
    const { deps } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    expect(await q.peekByKey("doc:saknas")).toBeNull();
  });
});

describe("UploadQueue.drainOnce", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("2xx → laddar upp, raderar posten + filerna", async () => {
    const { deps, puts } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("data"), authHeader: "Bearer t" });

    const res = await q.drainOnce();
    expect(res.uploaded).toBe(1);
    expect(puts[0]).toMatchObject({ url: "http://s/u/1", auth: "Bearer t" });
    expect(new TextDecoder().decode(puts[0]!.body)).toBe("data");
    expect(q.snapshot().total).toBe(0);
    expect(await readdir(dir)).toEqual([]);
  });

  test("document-mål → uploadDoc (tRPC), raderar posten (ADR 0031 write-back)", async () => {
    const f = fakeDeps([200]);
    const q = new UploadQueue(dir, f.deps);
    await q.enqueue({ document: { id: "d1", trpcUrl: "http://s/api/trpc" }, fileName: "a.docx", bytes: bytes("data"), authHeader: "Bearer t" });

    const res = await q.drainOnce();
    expect(res.uploaded).toBe(1);
    expect(f.puts).toHaveLength(0); // tRPC, inte PUT
    expect(f.uploadDocs[0]).toMatchObject({ document: { id: "d1" }, auth: "Bearer t" });
    expect(new TextDecoder().decode(f.uploadDocs[0]!.body)).toBe("data");
    expect(q.snapshot().total).toBe(0);
  });

  test("document-upload kastar → failed, behålls för retry", async () => {
    const f = fakeDeps([200], true); // uploadDoc kastar
    const q = new UploadQueue(dir, f.deps);
    await q.enqueue({ document: { id: "d1", trpcUrl: "http://s/api/trpc" }, fileName: "a.docx", bytes: bytes("x") });
    expect((await q.drainOnce()).failed).toBe(1);
    const entry = q.snapshot().entries[0]!;
    expect(entry.status).toBe("pending");
    expect(entry.lastError).toContain("trpc boom");
  });

  test("409 → markerar conflict, slutar retr:a, skriver aldrig över", async () => {
    const { deps, puts } = fakeDeps([409]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x") });

    expect((await q.drainOnce()).conflicted).toBe(1);
    expect(q.snapshot()).toMatchObject({ pending: 0, conflict: 1 });
    // En andra dränering rör inte konflikt-posten (skippas).
    const res2 = await q.drainOnce();
    expect(res2.uploaded + res2.failed + res2.conflicted).toBe(0);
    expect(puts).toHaveLength(1);
  });

  test("nätfel → ökar attempts + backoff, behåller posten", async () => {
    const q = new UploadQueue(dir, { ...fakeDeps(() => Promise.reject(new Error("ECONNREFUSED"))).deps });
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x") });
    const res = await q.drainOnce();
    expect(res.failed).toBe(1);
    const entry = q.snapshot().entries[0]!;
    expect(entry.status).toBe("pending");
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toContain("ECONNREFUSED");
  });

  test("5xx → räknas som fel, behålls för retry", async () => {
    const { deps } = fakeDeps([503]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x") });
    expect((await q.drainOnce()).failed).toBe(1);
    expect(q.snapshot().entries[0]!.lastError).toBe("HTTP 503");
  });

  test("backoff skippar post som inte är förfallen än", async () => {
    const { deps } = fakeDeps([503, 200]);
    const q = new UploadQueue(dir, deps); // klockan står still → nextAttemptAt i framtiden
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x") });
    await q.drainOnce(); // failar → nextAttemptAt = now + backoff
    const res2 = await q.drainOnce(); // samma now → skippas
    expect(res2.skipped).toBe(1);
    expect(res2.uploaded).toBe(0);
  });

  test("retry lyckas när backoff passerat (tick)", async () => {
    const f = fakeDeps([503, 200]);
    const q = new UploadQueue(dir, f.deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x") });
    await q.drainOnce();
    f.tick(); // förbi backoff
    expect((await q.drainOnce()).uploaded).toBe(1);
    expect(q.snapshot().total).toBe(0);
  });

  test("ny save på en konflikt-post nollställer den till pending", async () => {
    const { deps } = fakeDeps([409, 200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("v1") });
    await q.drainOnce(); // → conflict
    expect(q.snapshot().conflict).toBe(1);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("v2") }); // användaren sparar igen
    expect(q.snapshot()).toMatchObject({ pending: 1, conflict: 0 });
    expect((await q.drainOnce()).uploaded).toBe(1);
  });
});

describe("UploadQueue.recover", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("läser in kvarvarande poster efter omstart", async () => {
    const { deps } = fakeDeps([200]);
    const q1 = new UploadQueue(dir, deps);
    await q1.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("data") });

    // Ny instans (simulerar helper-omstart) mot samma katalog.
    const q2 = new UploadQueue(dir, fakeDeps([200]).deps);
    await q2.recover();
    expect(q2.snapshot().total).toBe(1);
    expect((await q2.drainOnce()).uploaded).toBe(1); // dränerar det återställda
  });

  test("saknad katalog → tom kö (ingen krasch)", async () => {
    const q = new UploadQueue(join(dir, "finns-ej"), fakeDeps([200]).deps);
    await q.recover();
    expect(q.snapshot().total).toBe(0);
  });

  test("manifest utan bytes-fil → hoppas över", async () => {
    await writeFile(join(dir, "orphan.json"), JSON.stringify({ id: "orphan", uploadUrl: "http://s/x", fileName: "a", enqueuedAt: 0, attempts: 0, nextAttemptAt: 0, status: "pending" }), "utf8");
    const q = new UploadQueue(dir, fakeDeps([200]).deps);
    await q.recover();
    expect(q.snapshot().total).toBe(0);
  });

  test("trasigt manifest → hoppas över utan att fälla recover", async () => {
    await writeFile(join(dir, "broken.json"), "{ not json", "utf8");
    const q = new UploadQueue(dir, fakeDeps([200]).deps);
    await q.recover();
    expect(q.snapshot().total).toBe(0);
  });
});

describe("backoffMs", () => {
  test("exponentiell med tak på 5 min", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(10_000);
    expect(backoffMs(3)).toBe(20_000);
    expect(backoffMs(99)).toBe(5 * 60_000); // taklagt
  });
});

describe("startDrainLoop", () => {
  let dir: string;
  beforeEach(async () => { dir = await tmpDir(); });

  test("dränerar periodiskt tills signalen avbryts", async () => {
    const { deps } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x") });
    const ctrl = new AbortController();
    q.startDrainLoop(ctrl.signal, 5);
    // Poll tills dränerad (robust mot lastad CI-runner) i st.f. fast väntan.
    for (let i = 0; i < 100 && q.snapshot().total > 0; i++) await new Promise((r) => setTimeout(r, 10));
    ctrl.abort();
    expect(q.snapshot().total).toBe(0); // hann dränera
  });

  test("avbruten signal innan tick → ingen dränering", async () => {
    const { deps, puts } = fakeDeps([200]);
    const q = new UploadQueue(dir, deps);
    await q.enqueue({ uploadUrl: "http://s/u/1", fileName: "a", bytes: bytes("x") });
    const ctrl = new AbortController();
    ctrl.abort();
    q.startDrainLoop(ctrl.signal, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(puts).toHaveLength(0);
  });
});

describe("defaultQueueDeps", () => {
  test("put gör en riktig PUT med rätt headers (mockad fetch)", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("", { status: 200 });
    }) as typeof fetch;
    try {
      const status = await defaultQueueDeps.put("http://s/u", bytes("x"), "Bearer t");
      expect(status).toBe(200);
      expect(calls[0]!.init.method).toBe("PUT");
      expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("newId ger unika id:n", () => {
    expect(defaultQueueDeps.newId()).not.toBe(defaultQueueDeps.newId());
  });

  test("uploadDoc gör en tRPC uploadContent-mutation med Bearer (mockad fetch)", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify([{ result: { data: superjson.serialize({ id: "d1" }) } }]), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
    try {
      await defaultQueueDeps.uploadDoc({ id: "d1", trpcUrl: "http://s/api/trpc" }, bytes("x"), "Bearer t");
      expect(calls[0]!.url).toContain("/api/trpc");
      expect(calls[0]!.url).toContain("document.uploadContent");
      expect(calls[0]!.auth).toBe("Bearer t");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
