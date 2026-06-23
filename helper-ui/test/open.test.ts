import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { asId } from "@/lib/shared/schemas/ids";

import { ContentStore } from "../src/engine/content-store.ts";
import type { UploadTarget } from "../src/engine/document-source.ts";
import { enqueueSavedFile, handleOpen, persistDownloaded, restoreCached, type OpenDeps } from "../src/engine/open.ts";
import { UploadQueue } from "../src/engine/queue.ts";
import { jsonRequest } from "./helpers.ts";

const sessionDirs: string[] = [];
afterAll(async () => { await Promise.all(sessionDirs.map((d) => rm(d, { recursive: true, force: true }))); });

interface Recorder {
  sessionDir: string;
  downloaded: string[]; // källnyckel (downloadUrl eller doc:<id>)
  opened: string[];
  watched: Array<{ path: string; target: UploadTarget; timeoutMs: number }>;
  heartbeats: Array<{ documentId: string; timeoutMs: number }>;
  deps: OpenDeps;
}

function recorder(overrides: Partial<OpenDeps> = {}): Recorder {
  const rec: Recorder = { sessionDir: "", downloaded: [], opened: [], watched: [], heartbeats: [], deps: {} as OpenDeps };
  rec.deps = {
    // Returnerar bytes + basversion (ADR 0031/0033); obtainFile skriver filen.
    download: async (ref) => {
      rec.downloaded.push(ref.downloadUrl ?? `doc:${ref.document?.id ?? ""}`);
      return { bytes: new TextEncoder().encode("DL"), ...(ref.document ? { version: 7 } : {}) };
    },
    openApp: async (path) => { rec.opened.push(path); },
    makeSessionDir: async () => {
      const d = await mkdtemp(join(tmpdir(), "ava-open-"));
      sessionDirs.push(d);
      rec.sessionDir = d;
      return d;
    },
    startWatch: (path, target, _auth, timeoutMs) => { rec.watched.push({ path, target, timeoutMs }); },
    // Heartbeat-default registrerar bara (anropas när VI äger leasen).
    startLeaseHeartbeat: (document, _auth, timeoutMs) => { rec.heartbeats.push({ documentId: document.id, timeoutMs }); },
    ...overrides,
  };
  return rec;
}

function openReq(body: unknown): Request {
  return jsonRequest("/open", body);
}

describe("handleOpen", () => {
  test("hämtar + öppnar + svarar 200 med path (statisk källa)", async () => {
    const rec = recorder();
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; status: string };
    expect(body.status).toBe("opened");
    expect(body.path).toBe(join(rec.sessionDir, "a.pdf"));
    expect(rec.downloaded).toEqual(["http://x/f"]);
    expect(rec.opened).toEqual([join(rec.sessionDir, "a.pdf")]);
    expect(rec.watched).toHaveLength(0);
    // Filen skrevs till disk med de hämtade bytsen.
    expect(await readFile(join(rec.sessionDir, "a.pdf"), "utf8")).toBe("DL");
  });

  test("document-källa (server-tier, tRPC) → download får ref.document", async () => {
    const rec = recorder();
    const res = await handleOpen(
      openReq({ document: { id: "doc-7", trpcUrl: "http://s/api/trpc" }, fileName: "a.pdf" }),
      rec.deps,
    );
    expect(res.status).toBe(200);
    expect(rec.downloaded).toEqual(["doc:doc-7"]);
  });

  test("local-first: väntande lokal kopia öppnas, ingen download (ADR 0032)", async () => {
    const rec = recorder({ pendingBytes: async () => new TextEncoder().encode("LOKAL-EDIT") });
    const res = await handleOpen(openReq({ document: { id: "d1", trpcUrl: "x" }, fileName: "a.docx" }), rec.deps);
    expect(res.status).toBe(200);
    expect(rec.downloaded).toHaveLength(0); // download hoppades över
    expect(await readFile(join(rec.sessionDir, "a.docx"), "utf8")).toBe("LOKAL-EDIT");
  });

  test("document-källa → watch-målet bär nedladdningens basversion (ADR 0033 §1)", async () => {
    const rec = recorder();
    await handleOpen(openReq({ document: { id: "doc-7", trpcUrl: "http://s/api/trpc" }, fileName: "a.docx" }), rec.deps);
    expect(rec.watched).toHaveLength(1);
    expect(rec.watched[0]?.target).toMatchObject({ document: { id: "doc-7" }, baseVersion: 7 });
  });

  test("local-first lokal kopia → ingen download-version (kön äger basen)", async () => {
    const rec = recorder({ pendingBytes: async () => new TextEncoder().encode("LOKAL") });
    await handleOpen(openReq({ document: { id: "doc-7", trpcUrl: "http://s/api/trpc" }, fileName: "a.docx" }), rec.deps);
    expect(rec.downloaded).toHaveLength(0); // hämtade aldrig (local-first)
    expect(rec.watched[0]?.target.baseVersion).toBeUndefined();
  });

  test("startar watch när uploadUrl satt (default 60 min)", async () => {
    const rec = recorder();
    await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf", uploadUrl: "http://x/u" }), rec.deps);
    expect(rec.watched).toHaveLength(1);
    expect(rec.watched[0]?.timeoutMs).toBe(60 * 60_000);
  });

  test("respekterar maxWatchMinutes", async () => {
    const rec = recorder();
    await handleOpen(
      openReq({ downloadUrl: "http://x/f", fileName: "a.pdf", uploadUrl: "http://x/u", maxWatchMinutes: 5 }),
      rec.deps,
    );
    expect(rec.watched[0]?.timeoutMs).toBe(5 * 60_000);
  });

  test("kräver källa + fileName", async () => {
    const rec = recorder();
    const res = await handleOpen(openReq({ fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(400);
  });

  test("502 vid hämtningsfel", async () => {
    const rec = recorder({ download: async () => { throw new Error("HTTP 404"); } });
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(502);
    expect(rec.opened).toHaveLength(0);
  });

  test("500 vid open-fel", async () => {
    const rec = recorder({ openApp: async () => { throw new Error("no app"); } });
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(500);
  });
});

describe("lease (ADR 0033 §2/§4)", () => {
  const docReq = { document: { id: "d7", trpcUrl: "http://s/api/trpc" }, fileName: "a.docx" };

  test("fri lease (acquired) → redigerbart: watch + heartbeat startas", async () => {
    const rec = recorder({ acquireLease: async () => ({ acquired: true, holderId: "u1", holderName: "Jag", stale: false }) });
    const res = await handleOpen(openReq(docReq), rec.deps);
    const body = (await res.json()) as { status: string; readOnly?: boolean };
    expect(body.status).toBe("opened");
    expect(body.readOnly).toBeUndefined();
    expect(rec.watched).toHaveLength(1);
    expect(rec.heartbeats).toEqual([{ documentId: "d7", timeoutMs: 60 * 60_000 }]);
  });

  test("leasat av annan → skrivskyddat: ingen watch, ingen heartbeat, hållare i svaret", async () => {
    const rec = recorder({ acquireLease: async () => ({ acquired: false, holderId: "u2", holderName: "Anna", stale: false }) });
    const res = await handleOpen(openReq(docReq), rec.deps);
    const body = (await res.json()) as { status: string; readOnly?: boolean; leaseHolder?: string };
    expect(body.status).toBe("read-only");
    expect(body.readOnly).toBe(true);
    expect(body.leaseHolder).toBe("Anna");
    expect(rec.opened).toHaveLength(1); // öppnas ändå (för läsning)
    expect(rec.watched).toHaveLength(0);
    expect(rec.heartbeats).toHaveLength(0);
  });

  test("forceEdit + leasat av annan → lånar: redigerbart + watch men INGEN heartbeat", async () => {
    const rec = recorder({ acquireLease: async () => ({ acquired: false, holderId: "u2", holderName: "Anna", stale: false }) });
    const res = await handleOpen(openReq({ ...docReq, forceEdit: true }), rec.deps);
    expect(((await res.json()) as { status: string }).status).toBe("opened");
    expect(rec.watched).toHaveLength(1);
    expect(rec.heartbeats).toHaveLength(0); // lånat → äger inte leasen
  });

  test("readOnly-flagga → skrivskyddat utan att ens ta leasen", async () => {
    let acquireCalled = false;
    const rec = recorder({ acquireLease: async () => { acquireCalled = true; return { acquired: true, holderId: "u1", holderName: "Jag", stale: false }; } });
    const res = await handleOpen(openReq({ ...docReq, readOnly: true }), rec.deps);
    expect(((await res.json()) as { status: string }).status).toBe("read-only");
    expect(acquireCalled).toBe(false);
    expect(rec.watched).toHaveLength(0);
  });

  test("ingen lease-dep wirad → redigerbart (bakåtkompatibelt)", async () => {
    const rec = recorder(); // ingen acquireLease
    const res = await handleOpen(openReq(docReq), rec.deps);
    expect(((await res.json()) as { status: string }).status).toBe("opened");
    expect(rec.watched).toHaveLength(1);
    expect(rec.heartbeats).toHaveLength(0); // äger ingen lease → ingen heartbeat
  });
});

describe("offline content-cache (ADR 0028 §3)", () => {
  test("cachar hämtade bytes via persist (nyckel + bytes)", async () => {
    const persisted: Array<{ cacheKey: string; fileName: string; content: string }> = [];
    const rec = recorder({
      persist: async (cacheKey, bytes, fileName) => {
        persisted.push({ cacheKey, fileName, content: new TextDecoder().decode(bytes) });
      },
    });
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(200);
    expect(persisted).toEqual([{ cacheKey: "http://x/f", fileName: "a.pdf", content: "DL" }]);
  });

  test("hämtning misslyckas men cache finns → öppnar cachad kopia (offline)", async () => {
    const rec = recorder({
      download: async () => { throw new Error("offline"); },
      restore: async () => true,
    });
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(200);
    expect(rec.opened).toEqual([join(rec.sessionDir, "a.pdf")]); // öppnades trots hämtningsfel
  });

  test("hämtning misslyckas + ingen cache → 502", async () => {
    const rec = recorder({
      download: async () => { throw new Error("offline"); },
      restore: async () => false,
    });
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(502);
    expect(rec.opened).toHaveLength(0);
  });

  test("persist-fel kraschar inte öppningen (cache best-effort)", async () => {
    const rec = recorder({ persist: async () => { throw new Error("disk full"); } });
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(200);
    expect(rec.opened).toHaveLength(1);
  });
});

describe("persistDownloaded + restoreCached", () => {
  const dirs: string[] = [];
  afterAll(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

  test("round-trip: persist hämtade bytes under nyckel, restore till ny path", async () => {
    const work = await mkdtemp(join(tmpdir(), "ava-dl-"));
    const cdir = await mkdtemp(join(tmpdir(), "ava-cs-"));
    dirs.push(work, cdir);

    const store = new ContentStore(cdir);
    await persistDownloaded(store, "doc:1", new TextEncoder().encode("nedladdat innehåll"), "doc.pdf");

    const out = join(work, "restored.pdf");
    const ok = await restoreCached(store, "doc:1", out);
    expect(ok).toBe(true);
    expect(await Bun.file(out).text()).toBe("nedladdat innehåll");
  });

  test("restoreCached → false när inget cachat finns", async () => {
    const cdir = await mkdtemp(join(tmpdir(), "ava-cs-"));
    dirs.push(cdir);
    const store = new ContentStore(cdir);
    expect(await restoreCached(store, "doc:saknas", join(cdir, "x"))).toBe(false);
  });
});

describe("enqueueSavedFile", () => {
  const dirs: string[] = [];
  afterAll(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

  test("läser sparade bytes och köar dem durabelt i kön", async () => {
    const work = await mkdtemp(join(tmpdir(), "ava-save-"));
    const qdir = await mkdtemp(join(tmpdir(), "ava-q-"));
    dirs.push(work, qdir);
    const filePath = join(work, "avtal.docx");
    await writeFile(filePath, "ändrat innehåll", "utf8");

    const queue = new UploadQueue(qdir);
    await enqueueSavedFile(queue, filePath, { document: { id: asId<"DocumentId">("doc-7"), trpcUrl: "http://s/api/trpc" }, baseVersion: 4 }, "Bearer tok");

    const snap = queue.snapshot();
    expect(snap.total).toBe(1);
    expect(snap.entries[0]).toMatchObject({ document: { id: "doc-7" }, fileName: "avtal.docx", status: "pending", baseVersion: 4 });
  });
});
