/**
 * Tester för innehålls-adressering (#518, ADR 0023) — sha256, base64-roundtrip,
 * storagePath.
 */

import { describe, expect, it } from "vitest-compat";
import { base64ToBytes, bytesToBase64, contentStoragePath, sha256Hex } from "@/lib/shared/content-address";

describe("content-address", () => {
  it("sha256Hex matchar känt testvektor (tomma bytes)", async () => {
    // sha256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    expect(await sha256Hex(new Uint8Array([]))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("sha256Hex är deterministisk + skiljer på innehåll", async () => {
    const a = await sha256Hex(new Uint8Array([1, 2, 3]));
    const b = await sha256Hex(new Uint8Array([1, 2, 3]));
    const c = await sha256Hex(new Uint8Array([1, 2, 4]));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("base64 roundtrip bevarar bytes (inkl. > chunk-gränsen)", () => {
    const big = new Uint8Array(40000).map((_, i) => i % 256);
    expect(Array.from(base64ToBytes(bytesToBase64(big)))).toEqual(Array.from(big));
  });

  it("contentStoragePath bygger repo-relativ hash-sökväg", () => {
    expect(contentStoragePath("abc123")).toBe("documents/content/abc123");
  });
});
