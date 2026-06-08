/**
 * Tester för document-content-cache.
 */

import { describe, it, expect, beforeEach, vi } from "vitest-compat";
import {
  isPlainTextDoc,
  fetchPlainText,
  preloadDocumentContents,
  getDocumentContent,
  setDocumentContent,
  clearDocumentContentCache,
} from "@/lib/client/demo/document-content-cache";

beforeEach(() => clearDocumentContentCache());

describe("isPlainTextDoc", () => {
  it("matchar .md/.txt/.json via storagePath", () => {
    expect(isPlainTextDoc({ id: "1", storagePath: "documents/content/x.md" })).toBe(true);
    expect(isPlainTextDoc({ id: "2", storagePath: "documents/content/x.txt" })).toBe(true);
    expect(isPlainTextDoc({ id: "3", storagePath: "documents/content/x.json" })).toBe(true);
  });

  it("matchar mimeType text/*", () => {
    expect(isPlainTextDoc({ id: "1", mimeType: "text/markdown" })).toBe(true);
    expect(isPlainTextDoc({ id: "2", mimeType: "text/plain" })).toBe(true);
  });

  it("avvisar PDF/DOCX", () => {
    expect(isPlainTextDoc({ id: "1", storagePath: "x.pdf", mimeType: "application/pdf" })).toBe(false);
    expect(isPlainTextDoc({ id: "2", storagePath: "x.docx" })).toBe(false);
  });
});

describe("fetchPlainText", () => {
  it("returnerar text vid 200 OK", async () => {
    const fakeFetch = vi.fn(async () => ({
      ok: true,
      text: async () => "Hej, världen.",
    } as Response));
    expect(await fetchPlainText("http://x", fakeFetch as unknown as typeof fetch)).toBe("Hej, världen.");
  });

  it("returnerar null vid 404", async () => {
    const fakeFetch = vi.fn(async () => ({ ok: false } as Response));
    expect(await fetchPlainText("http://x", fakeFetch as unknown as typeof fetch)).toBeNull();
  });

  it("returnerar null vid nät-fel (kastar)", async () => {
    const fakeFetch = vi.fn(async () => { throw new Error("network"); });
    expect(await fetchPlainText("http://x", fakeFetch as unknown as typeof fetch)).toBeNull();
  });
});

describe("preloadDocumentContents + getDocumentContent", () => {
  it("fyller cache:n med text från text-dokument (fallback till content/ när text/ saknas)", async () => {
    // Koden försöker FÖRST documents/text/<id>.txt (extraherad text); om den
    // inte finns faller den tillbaka till documents/content/<id>.<ext>.
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      if (u.includes("/documents/text/")) return { ok: false } as Response; // ingen extraherad text ännu
      return { ok: true, text: async () => `content of ${u}` } as Response;
    });
    const docs = [
      { id: "d-1", storagePath: "documents/content/d-1.md" },
      { id: "d-2", storagePath: "documents/content/d-2.pdf" }, // ej text
    ];
    await preloadDocumentContents(docs, "https://example.com/repo", fakeFetch as unknown as typeof fetch);
    expect(getDocumentContent("d-1")).toContain("d-1.md");
    expect(getDocumentContent("d-2")).toBe(""); // PDF skippas (saknar både text/ och plain-text-typ)
  });

  it("föredrar extraherad text från documents/text/ när den finns", async () => {
    const fakeFetch = vi.fn(async (url: string | URL | Request) => ({
      ok: true,
      text: async () => `extracted from ${url.toString()}`,
    } as Response));
    await preloadDocumentContents(
      [{ id: "d-1", storagePath: "documents/content/d-1.pdf", mimeType: "application/pdf" }],
      "https://example.com/repo",
      fakeFetch as unknown as typeof fetch,
    );
    expect(getDocumentContent("d-1")).toContain("/documents/text/d-1.txt");
  });

  it("skipa redan-cached dokument", async () => {
    setDocumentContent("d-1", "redan cached");
    const fakeFetch = vi.fn();
    await preloadDocumentContents(
      [{ id: "d-1", storagePath: "documents/content/d-1.md" }],
      "http://x",
      fakeFetch as unknown as typeof fetch,
    );
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(getDocumentContent("d-1")).toBe("redan cached");
  });

  it("getDocumentContent returnerar '' om saknas", () => {
    expect(getDocumentContent("okänd-id")).toBe("");
  });

  it("byggs URL korrekt utan dubbla slashes", async () => {
    const seenUrls: string[] = [];
    const fakeFetch = vi.fn(async (url: string | URL | Request) => {
      const u = url.toString();
      seenUrls.push(u);
      // text/ branch saknas → faller till content/
      if (u.includes("/documents/text/")) return { ok: false } as Response;
      return { ok: true, text: async () => "x" } as Response;
    });
    await preloadDocumentContents(
      [{ id: "d-1", storagePath: "documents/content/d-1.md" }],
      "https://example.com/repo/",   // trailing slash → ska normaliseras
      fakeFetch as unknown as typeof fetch,
    );
    // Ingen dubbel slash trots trailing slash i baseUrl
    expect(seenUrls.every((u) => !u.includes("repo//"))).toBe(true);
    // text/-källan slås upp först
    expect(seenUrls[0]).toBe("https://example.com/repo/documents/text/d-1.txt");
    // content/-fallback följer
    expect(seenUrls).toContain("https://example.com/repo/documents/content/d-1.md");
  });
});
