/**
 * `POST /content` (ADR 0028 §3/§5) — leverera dokument-bytes ur durabla cachen.
 * handleContent testas med injicerade deps; fetchAndCacheContent mot riktig
 * ContentStore + mockad fetch.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "bun:test";

import { ContentStore } from "../src/engine/content-store.ts";
import { fetchAndCacheContent, fileNameFromUrl, handleContent, type ContentDeps } from "../src/engine/content.ts";
import { jsonRequest } from "./helpers.ts";

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function contentReq(body: unknown): Request {
  return jsonRequest("/content", body);
}

describe("handleContent", () => {
  const base: ContentDeps = {
    load: async () => null,
    fetchAndCache: async () => null,
  };

  test("kräver POST", async () => {
    const res = await handleContent(new Request("http://h/content"), base);
    expect(res.status).toBe(405);
  });

  test("kräver källa (varken document eller downloadUrl)", async () => {
    const res = await handleContent(contentReq({ authHeader: "x" }), base);
    expect(res.status).toBe(400);
  });

  test("cache-hit → 200 + bytes (offline-ok), ingen nedladdning", async () => {
    let fetched = false;
    const res = await handleContent(contentReq({ downloadUrl: "http://s/d/1" }), {
      load: async () => bytes("cachat"),
      fetchAndCache: async () => { fetched = true; return null; },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(await res.text()).toBe("cachat");
    expect(fetched).toBe(false); // hit → ingen fetch
  });

  test("cache-miss (statisk) → hämtar via downloadUrl-källan + servar bytsen", async () => {
    const res = await handleContent(contentReq({ downloadUrl: "http://s/d/1", authHeader: "Bearer t" }), {
      load: async () => null,
      fetchAndCache: async (ref, cacheKey, auth) => {
        expect(ref.downloadUrl).toBe("http://s/d/1");
        expect(cacheKey).toBe("http://s/d/1"); // demo: nyckel = URL
        expect(auth).toBe("Bearer t");
        return bytes("nedladdat");
      },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("nedladdat");
  });

  test("document-källa (server-tier) → cache-nyckel doc:<id>, ref vidarebefordras", async () => {
    let seenKey = "";
    let seenId = "";
    const res = await handleContent(contentReq({ document: { id: "abc", trpcUrl: "http://s/api/trpc" } }), {
      load: async () => null,
      fetchAndCache: async (ref, cacheKey) => {
        seenKey = cacheKey;
        seenId = ref.document?.id ?? "";
        return bytes("trpc-bytes");
      },
    });
    expect(res.status).toBe(200);
    expect(seenKey).toBe("doc:abc");
    expect(seenId).toBe("abc");
  });

  test("miss + offline (hämtning ger null) → 502", async () => {
    const res = await handleContent(contentReq({ downloadUrl: "http://s/d/1" }), base);
    expect(res.status).toBe(502);
  });

  test("vidarebefordrar fileName till fetchAndCache (annars härlett ur URL)", async () => {
    let seenName = "";
    await handleContent(contentReq({ downloadUrl: "http://s/api/documents/9/download" }), {
      load: async () => null,
      fetchAndCache: async (_ref, _key, _auth, fileName) => { seenName = fileName; return bytes("x"); },
    });
    expect(seenName).toBe("download"); // sista segmentet
  });
});

describe("fileNameFromUrl", () => {
  test("plockar sista path-segmentet", () => {
    expect(fileNameFromUrl("http://s/api/documents/9/avtal.pdf")).toBe("avtal.pdf");
    expect(fileNameFromUrl("http://s/a/b/c.docx?token=xyz")).toBe("c.docx");
    expect(fileNameFromUrl("http://s/file%20namn.pdf")).toBe("file namn.pdf");
  });
  test("fallback när inget segment finns", () => {
    expect(fileNameFromUrl("http://s/")).toBe("dokument");
  });
});

describe("fetchAndCacheContent", () => {
  const dirs: string[] = [];
  afterAll(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

  async function store(): Promise<ContentStore> {
    const d = await mkdtemp(join(tmpdir(), "ava-cc-"));
    dirs.push(d);
    return new ContentStore(d);
  }

  function mockFetch(fn: (url: string, init?: RequestInit) => Response): () => void {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => fn(String(url), init)) as typeof fetch;
    return () => { globalThis.fetch = orig; };
  }

  test("laddar ner, cachar och returnerar bytsen", async () => {
    const s = await store();
    const restore = mockFetch((url, init) => {
      expect(url).toBe("http://s/d/1");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
      return new Response("hämtat", { status: 200 });
    });
    try {
      const got = await fetchAndCacheContent(s, { downloadUrl: "http://s/d/1" }, "http://s/d/1", "Bearer t", "a.pdf");
      expect(new TextDecoder().decode(got!)).toBe("hämtat");
      // cachat → en andra load (utan nät) ger samma bytes
      expect(new TextDecoder().decode((await s.load("http://s/d/1"))!)).toBe("hämtat");
    } finally { restore(); }
  });

  test("4xx → null (cachar inte)", async () => {
    const s = await store();
    const restore = mockFetch(() => new Response("nope", { status: 404 }));
    try {
      expect(await fetchAndCacheContent(s, { downloadUrl: "http://s/d/1" }, "http://s/d/1", undefined, "a.pdf")).toBeNull();
      expect(await s.has("http://s/d/1")).toBe(false);
    } finally { restore(); }
  });

  test("nätfel → null (offline)", async () => {
    const s = await store();
    const restore = mockFetch(() => { throw new Error("ECONNREFUSED"); });
    try {
      expect(await fetchAndCacheContent(s, { downloadUrl: "http://s/d/1" }, "http://s/d/1", undefined, "a.pdf")).toBeNull();
    } finally { restore(); }
  });
});
