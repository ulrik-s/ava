/**
 * Tester för `openDocument` — väljer rätt strategi för att öppna ett
 * dokument baserat på deploy-mode. Pure-fn → inga FSA-mocks behövs.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { openDocument, withUtf8CharsetIfText } from "@/lib/client/firma/open-document";
import { clearGeneratedDocCache, stashGeneratedDoc } from "@/lib/client/demo/generated-doc-cache";

const baseDoc = { id: "doc-1", storagePath: "documents/content/doc-1.md", fileName: "x.md" };

beforeEach(() => clearGeneratedDocCache());

describe("openDocument", () => {
  it("demo-mode → öppnar gh-pages-URL byggd från demoRepo", async () => {
    const openUrl = vi.fn();
    const result = await openDocument({
      doc: baseDoc,
      isDemo: true,
      demoRepo: "alice/firma",
      loadHandle: async () => null, // ignoreras i demo-mode
      readFromHandle: async () => null,
      openUrl,
      notifyError: vi.fn(),
    });
    expect(result).toBe("opened-gh-pages");
    expect(openUrl).toHaveBeenCalledWith("https://alice.github.io/firma/documents/content/doc-1.md");
  });

  it("demo-mode utan demoRepo → default ulrik-s/ava-demo", async () => {
    const openUrl = vi.fn();
    await openDocument({
      doc: baseDoc,
      isDemo: true,
      loadHandle: async () => null,
      readFromHandle: async () => null,
      openUrl,
      notifyError: vi.fn(),
    });
    expect(openUrl.mock.calls[0][0]).toContain("ulrik-s.github.io/ava-demo");
  });

  it("self-hosted utan handle → notifyError, ingen URL öppnad", async () => {
    const openUrl = vi.fn();
    const notifyError = vi.fn();
    const result = await openDocument({
      doc: baseDoc,
      isDemo: false,
      loadHandle: async () => null,
      readFromHandle: async () => null,
      openUrl,
      notifyError,
    });
    expect(result).toBe("error");
    expect(notifyError).toHaveBeenCalled();
    expect(notifyError.mock.calls[0][0]).toMatch(/working copy/i);
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("self-hosted med handle men saknad fil → notifyError med path", async () => {
    const fakeHandle = {} as FileSystemDirectoryHandle;
    const notifyError = vi.fn();
    const result = await openDocument({
      doc: baseDoc,
      isDemo: false,
      loadHandle: async () => fakeHandle,
      readFromHandle: async () => null, // hittas ej
      openUrl: vi.fn(),
      notifyError,
    });
    expect(result).toBe("error");
    expect(notifyError.mock.calls[0][0]).toMatch(/disk/i);
    expect(notifyError.mock.calls[0][0]).toContain("documents/content/doc-1.md");
  });

  it("self-hosted med fil → skapar blob-URL och öppnar", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:fake-url");
    globalThis.URL.revokeObjectURL = vi.fn();
    const fakeHandle = {} as FileSystemDirectoryHandle;
    const fakeBlob = new Blob(["hej"], { type: "text/markdown" });
    const openUrl = vi.fn();

    const result = await openDocument({
      doc: baseDoc,
      isDemo: false,
      loadHandle: async () => fakeHandle,
      readFromHandle: async () => fakeBlob,
      openUrl,
      notifyError: vi.fn(),
    });
    expect(result).toBe("opened-blob");
    expect(openUrl).toHaveBeenCalledWith("blob:fake-url");
  });

  it("self-hosted med .md fil → blob taggas med UTF-8 charset (annars trasas å/ä/ö)", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:url");
    globalThis.URL.revokeObjectURL = vi.fn();
    const fakeHandle = {} as FileSystemDirectoryHandle;
    const fakeBlob = new Blob(["text utan charset"], { type: "" });
    let capturedBlob: Blob | undefined;
    globalThis.URL.createObjectURL = vi.fn((b: Blob) => { capturedBlob = b; return "blob:fake"; });

    await openDocument({
      doc: { id: "x", storagePath: "documents/content/x.md", fileName: "x.md" },
      isDemo: false,
      loadHandle: async () => fakeHandle,
      readFromHandle: async () => fakeBlob,
      openUrl: vi.fn(),
      notifyError: vi.fn(),
    });
    expect(capturedBlob?.type).toBe("text/markdown; charset=utf-8");
  });

  it("blob-cached doc → öppnar via blob: URL (skippa gh-pages-URL)", async () => {
    globalThis.URL.createObjectURL = vi.fn(() => "blob:in-memory");
    globalThis.URL.revokeObjectURL = vi.fn();
    stashGeneratedDoc("doc-1", new TextEncoder().encode("<html/>"), "text/html", "k.html");
    const openUrl = vi.fn();
    const result = await openDocument({
      doc: baseDoc,
      isDemo: true,
      demoRepo: "alice/firma",
      loadHandle: async () => null,
      readFromHandle: async () => null,
      openUrl,
      notifyError: vi.fn(),
    });
    expect(result).toBe("opened-generated");
    expect(openUrl).toHaveBeenCalledWith("blob:in-memory");
  });

  it("fallback storagePath när doc saknar fältet → documents/<id>", async () => {
    const openUrl = vi.fn();
    await openDocument({
      doc: { id: "naked", fileName: "x" },
      isDemo: true,
      demoRepo: "a/b",
      loadHandle: async () => null,
      readFromHandle: async () => null,
      openUrl,
      notifyError: vi.fn(),
    });
    expect(openUrl.mock.calls[0][0]).toContain("/documents/naked");
  });
});

describe("withUtf8CharsetIfText", () => {
  it("md/txt/csv/json/html får text/* mime + charset=utf-8", () => {
    const blob = new Blob(["hej"], { type: "" });
    expect(withUtf8CharsetIfText(blob, "x.md").type).toBe("text/markdown; charset=utf-8");
    expect(withUtf8CharsetIfText(blob, "x.txt").type).toBe("text/plain; charset=utf-8");
    expect(withUtf8CharsetIfText(blob, "x.csv").type).toBe("text/csv; charset=utf-8");
    expect(withUtf8CharsetIfText(blob, "x.json").type).toBe("application/json; charset=utf-8");
    expect(withUtf8CharsetIfText(blob, "x.html").type).toBe("text/html; charset=utf-8");
  });

  it("binärt format (.pdf, .docx) lämnas orört", () => {
    const pdf = new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
    expect(withUtf8CharsetIfText(pdf, "doc.pdf").type).toBe("application/pdf");
    const docx = new Blob([new Uint8Array([0x50, 0x4B])], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    expect(withUtf8CharsetIfText(docx, "doc.docx").type).toContain("openxmlformats");
  });
});
