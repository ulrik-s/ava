/**
 * Tests för tryHelperOpen och shouldPreferExternalEdit.
 */

import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { tryHelperOpen, shouldPreferExternalEdit } from "@/lib/client/firma/open-document-externally";
import { resetHelperBaseCache } from "@/lib/client/helper/use-helper";

const originalFetch = global.fetch;
beforeEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  resetHelperBaseCache();
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
  it("returnerar null när /ping inte svarar (→ fallback)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await tryHelperOpen({ id: "d1", fileName: "f.pdf", storagePath: "p" });
    expect(result).toBeNull();
  });

  it("returnerar {kind:'done'} när helpern öppnade redigerbart", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("ava-helper v1.0.0\n", { status: 200 })) // /ping
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: "/tmp/f.pdf", status: "opened" }), { status: 200 })); // /open
    global.fetch = fetchMock;
    const result = await tryHelperOpen({ id: "d1", fileName: "f.pdf", storagePath: "documents/d1.pdf" });
    expect(result).toEqual({ kind: "done" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returnerar {kind:'read-only', leaseHolder} när leasat av annan (ADR 0033 §2)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("ava-helper v1.0.0\n", { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ path: "/tmp/f.pdf", status: "read-only", readOnly: true, leaseHolder: "Anna" }), { status: 200 }));
    global.fetch = fetchMock;
    const result = await tryHelperOpen({ id: "d1", fileName: "f.pdf", storagePath: "p" });
    expect(result).toEqual({ kind: "read-only", leaseHolder: "Anna" });
  });

  it("returnerar null när helpern svarar OK på /ping men /open kastar (→ fallback)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("ava-helper v1.0.0\n", { status: 200 }))
      .mockResolvedValueOnce(new Response("error", { status: 500 }));
    global.fetch = fetchMock;
    const result = await tryHelperOpen({ id: "d1", fileName: "f.pdf", storagePath: "p" });
    expect(result).toBeNull();
  });
});
