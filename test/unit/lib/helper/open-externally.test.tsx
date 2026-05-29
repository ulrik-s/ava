/**
 * Tests för tryHelperOpen och shouldPreferExternalEdit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { tryHelperOpen, shouldPreferExternalEdit } from "@/lib/client/firma/open-document-externally";

const originalFetch = global.fetch;
beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
});

describe("shouldPreferExternalEdit", () => {
  it("PDF/Word/Excel/PPT → ja", () => {
    expect(shouldPreferExternalEdit("foo.pdf")).toBe(true);
    expect(shouldPreferExternalEdit("foo.docx")).toBe(true);
    expect(shouldPreferExternalEdit("foo.xlsx")).toBe(true);
    expect(shouldPreferExternalEdit("foo.pptx")).toBe(true);
    expect(shouldPreferExternalEdit("RAPPORT.PDF")).toBe(true);
  });
  it("text/html/bilder → nej", () => {
    expect(shouldPreferExternalEdit("foo.txt")).toBe(false);
    expect(shouldPreferExternalEdit("foo.html")).toBe(false);
    expect(shouldPreferExternalEdit("foo.png")).toBe(false);
  });
});

describe("tryHelperOpen", () => {
  it("returnerar false när /ping inte svarar", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await tryHelperOpen({ id: "d1", fileName: "f.pdf", storagePath: "p" });
    expect(result).toBe(false);
  });

  it("returnerar true när helpern svarar OK på /ping och /open", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("ava-helper v1.0.0\n", { status: 200 })) // /ping
      .mockResolvedValueOnce(new Response("", { status: 200 })); // /open
    global.fetch = fetchMock;
    const result = await tryHelperOpen({ id: "d1", fileName: "f.pdf", storagePath: "documents/d1.pdf" });
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returnerar false när helpern svarar OK på /ping men /open kastar", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("ava-helper v1.0.0\n", { status: 200 }))
      .mockResolvedValueOnce(new Response("error", { status: 500 }));
    global.fetch = fetchMock;
    const result = await tryHelperOpen({ id: "d1", fileName: "f.pdf", storagePath: "p" });
    expect(result).toBe(false);
  });
});
