import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { enqueueSavedFile, handleOpen, type OpenDeps } from "../src/open.ts";
import { UploadQueue } from "../src/queue.ts";
import { jsonRequest } from "./helpers.ts";

interface Recorder {
  downloaded: string[];
  opened: string[];
  watched: Array<{ path: string; uploadUrl: string; timeoutMs: number }>;
  deps: OpenDeps;
}

function recorder(overrides: Partial<OpenDeps> = {}): Recorder {
  const rec: Recorder = {
    downloaded: [],
    opened: [],
    watched: [],
    deps: {} as OpenDeps,
  };
  rec.deps = {
    download: async (path) => { rec.downloaded.push(path); },
    openApp: async (path) => { rec.opened.push(path); },
    makeSessionDir: async () => "/tmp/ava-session",
    startWatch: (path, uploadUrl, _auth, timeoutMs) => { rec.watched.push({ path, uploadUrl, timeoutMs }); },
    ...overrides,
  };
  return rec;
}

function openReq(body: unknown): Request {
  return jsonRequest("/open", body);
}

describe("handleOpen", () => {
  test("laddar ner + öppnar + svarar 200 med path", async () => {
    const rec = recorder();
    const res = await handleOpen(openReq({ downloadUrl: "http://x/f", fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string; status: string };
    expect(body.status).toBe("opened");
    expect(body.path).toBe("/tmp/ava-session/a.pdf");
    expect(rec.downloaded).toEqual(["/tmp/ava-session/a.pdf"]);
    expect(rec.opened).toEqual(["/tmp/ava-session/a.pdf"]);
    expect(rec.watched).toHaveLength(0);
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

  test("kräver downloadUrl + fileName", async () => {
    const rec = recorder();
    const res = await handleOpen(openReq({ fileName: "a.pdf" }), rec.deps);
    expect(res.status).toBe(400);
  });

  test("502 vid nedladdningsfel", async () => {
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
    await enqueueSavedFile(queue, filePath, "http://s/api/documents/7/upload", "Bearer tok");

    const snap = queue.snapshot();
    expect(snap.total).toBe(1);
    expect(snap.entries[0]).toMatchObject({ uploadUrl: "http://s/api/documents/7/upload", fileName: "avtal.docx", status: "pending" });
  });
});
