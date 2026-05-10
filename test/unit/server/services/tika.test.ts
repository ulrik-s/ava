/**
 * Tester för Apache Tika-klienten. Mockar globalThis.fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { extractText } from "@/server/services/tika";

const origFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("extractText", () => {
  it("returnerar extraherad text vid 200 OK", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue("Hej världen"),
    } as unknown as Response);

    const buf = Buffer.from("PDF-DATA");
    const result = await extractText(buf, "application/pdf");
    expect(result).toBe("Hej världen");
  });

  it("anropar PUT /tika med rätt headers", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue("ok"),
    } as unknown as Response);

    await extractText(Buffer.from("x"), "image/png");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/tika$/);
    expect(opts.method).toBe("PUT");
    expect(opts.headers["Content-Type"]).toBe("image/png");
    expect(opts.headers["Accept"]).toBe("text/plain");
  });

  it("skickar buffer som Uint8Array body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue("ok"),
    } as unknown as Response);

    const buf = Buffer.from([1, 2, 3, 4]);
    await extractText(buf, "application/octet-stream");
    const opts = fetchMock.mock.calls[0][1];
    expect(opts.body).toBeInstanceOf(Uint8Array);
    expect(Array.from(opts.body)).toEqual([1, 2, 3, 4]);
  });

  it("kastar med status-kod när Tika svarar !ok (500)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);

    await expect(extractText(Buffer.from("x"), "application/pdf")).rejects.toThrow(
      /Tika extraction failed: 500/,
    );
  });

  it("kastar för 415 Unsupported Media Type", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 415,
      statusText: "Unsupported Media Type",
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);

    await expect(extractText(Buffer.from("x"), "weird/type")).rejects.toThrow(
      /415/,
    );
  });

  it("propagerar nätverksfel", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    await expect(extractText(Buffer.from("x"), "application/pdf")).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("returnerar tom sträng om Tika returnerar tomt body", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(""),
    } as unknown as Response);
    const result = await extractText(Buffer.from("x"), "application/pdf");
    expect(result).toBe("");
  });
});
