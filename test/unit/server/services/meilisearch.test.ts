/**
 * Tester för Meilisearch-klienten. Mockar globalThis.fetch och kontrollerar
 * URL/method/headers/body samt felhantering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ensureIndex,
  indexDocument,
  removeDocument,
  searchDocuments,
  type DocumentIndex,
} from "@/server/services/meilisearch";

let fetchMock: ReturnType<typeof vi.fn>;
const origFetch = globalThis.fetch;

function okJson(data: unknown = {}) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

function failJson(status = 500) {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({ message: "boom" }),
    text: vi.fn().mockResolvedValue("boom"),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.MEILI_URL = "http://meili.test:7700";
  process.env.MEILI_MASTER_KEY = "test-key";
  fetchMock = vi.fn().mockResolvedValue(okJson());
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("ensureIndex", () => {
  it("anropar PATCH /indexes/documents, POST /indexes och PATCH /settings", async () => {
    await ensureIndex();
    // 3 calls expected
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    // Note: env is captured at module load — we can't easily reassign.
    // Just check path suffixes:
    expect(urls.some((u: string) => u.endsWith("/indexes/documents"))).toBe(true);
    expect(urls.some((u: string) => u.endsWith("/indexes"))).toBe(true);
    expect(urls.some((u: string) => u.endsWith("/indexes/documents/settings"))).toBe(true);
  });

  it("skickar Authorization-header med MEILI_MASTER_KEY", async () => {
    await ensureIndex();
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.headers["Authorization"]).toMatch(/^Bearer /);
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("settings-PATCH skickar searchable + filterable attribut", async () => {
    await ensureIndex();
    const settingsCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).endsWith("/indexes/documents/settings"),
    );
    expect(settingsCall).toBeDefined();
    const body = JSON.parse(settingsCall![1].body as string);
    expect(body.searchableAttributes).toEqual(["content", "fileName"]);
    expect(body.filterableAttributes).toEqual(["matterId", "organizationId"]);
  });

  it("sväljer fel från PATCH/POST på indexes (catch ⇒ null)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"));
    fetchMock.mockRejectedValueOnce(new Error("network"));
    fetchMock.mockResolvedValueOnce(okJson()); // settings success
    await expect(ensureIndex()).resolves.toBeUndefined();
  });
});

describe("indexDocument", () => {
  it("POSTar dokumentet till /indexes/documents/documents", async () => {
    const doc: DocumentIndex = {
      id: "d1",
      fileName: "kontrakt.pdf",
      content: "lorem ipsum",
      matterId: "m1",
      matterNumber: "2026-0001",
      matterTitle: "Test",
      organizationId: "org1",
    };
    await indexDocument(doc);
    // ensureIndex => 3 calls + indexDocument POST = 4
    const docCall = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "POST" && String(c[0]).endsWith("/indexes/documents/documents"),
    );
    expect(docCall).toBeDefined();
    const body = JSON.parse(docCall![1].body as string);
    expect(body).toEqual([doc]);
  });
});

describe("removeDocument", () => {
  it("DELETE:ar /indexes/documents/documents/:id", async () => {
    await removeDocument("d-42");
    const call = fetchMock.mock.calls.find(
      (c) => c[1]?.method === "DELETE",
    );
    expect(call).toBeDefined();
    expect(String(call![0])).toMatch(/\/indexes\/documents\/documents\/d-42$/);
  });
});

describe("searchDocuments", () => {
  it("POSTar query med organizationId-filter och returnerar hits", async () => {
    fetchMock.mockResolvedValue(okJson()); // ensureIndex calls
    const hits = [{ id: "d1", fileName: "f.pdf" }];
    // Last call (search) returns hits
    fetchMock.mockResolvedValueOnce(okJson()); // patch index
    fetchMock.mockResolvedValueOnce(okJson()); // post indexes
    fetchMock.mockResolvedValueOnce(okJson()); // patch settings
    fetchMock.mockResolvedValueOnce(okJson({ hits, estimatedTotalHits: 1 })); // search

    const res = await searchDocuments("kontrakt", "org1", 10);
    expect(res.hits).toEqual(hits);
    expect(res.estimatedTotalHits).toBe(1);

    const searchCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/indexes/documents/search"),
    );
    expect(searchCall).toBeDefined();
    const body = JSON.parse(searchCall![1].body as string);
    expect(body.q).toBe("kontrakt");
    expect(body.filter).toBe('organizationId = "org1"');
    expect(body.limit).toBe(10);
    expect(body.attributesToHighlight).toEqual(["content", "fileName"]);
  });

  it("kastar fel när search returnerar !ok", async () => {
    fetchMock.mockResolvedValueOnce(okJson());
    fetchMock.mockResolvedValueOnce(okJson());
    fetchMock.mockResolvedValueOnce(okJson());
    fetchMock.mockResolvedValueOnce(failJson(500));

    await expect(searchDocuments("x", "org1")).rejects.toThrow(/Meilisearch search failed/);
  });

  it("default limit är 20", async () => {
    fetchMock.mockResolvedValueOnce(okJson());
    fetchMock.mockResolvedValueOnce(okJson());
    fetchMock.mockResolvedValueOnce(okJson());
    fetchMock.mockResolvedValueOnce(okJson({ hits: [], estimatedTotalHits: 0 }));

    await searchDocuments("q", "org1");
    const searchCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith("/indexes/documents/search"),
    );
    const body = JSON.parse(searchCall![1].body as string);
    expect(body.limit).toBe(20);
  });
});
