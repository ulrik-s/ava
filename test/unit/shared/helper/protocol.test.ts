import { describe, it, expect } from "vitest";

import {
  formatPing,
  HELPER_BASE,
  HELPER_PING_PREFIX,
  HELPER_PORT,
  isAllowedOrigin,
  isSafeFileName,
  parsePingVersion,
} from "@/lib/shared/helper/protocol";

describe("konstanter", () => {
  it("HELPER_BASE byggs av porten", () => {
    expect(HELPER_PORT).toBe(48761);
    expect(HELPER_BASE).toBe("http://127.0.0.1:48761");
  });
});

describe("formatPing / parsePingVersion (round-trip)", () => {
  it("formatPing producerar 'ava-helper <v>\\n'", () => {
    expect(formatPing("v1.2.3")).toBe(`${HELPER_PING_PREFIX} v1.2.3\n`);
  });
  it("parsePingVersion plockar versionen", () => {
    expect(parsePingVersion("ava-helper v1.2.3")).toBe("v1.2.3");
    expect(parsePingVersion(formatPing("v9.9.9"))).toBe("v9.9.9");
    expect(parsePingVersion("  ava-helper   dev  ")).toBe("dev");
  });
  it("null för ogiltigt format", () => {
    expect(parsePingVersion("garbage")).toBeNull();
    expect(parsePingVersion("")).toBeNull();
  });
});

describe("isSafeFileName", () => {
  it("tillåter normala namn (inkl mellanslag + svenska tecken)", () => {
    for (const n of ["foo.pdf", "förordnande.docx", "rapport 2026-05.xlsx"]) {
      expect(isSafeFileName(n)).toBe(true);
    }
  });
  it("avvisar traversal/separatorer", () => {
    for (const n of ["", ".", "..", "../etc", "a/b", "a\\b"]) {
      expect(isSafeFileName(n)).toBe(false);
    }
  });
});

describe("isAllowedOrigin", () => {
  it("tillåter localhost + 127.0.0.1-portar", () => {
    expect(isAllowedOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8080")).toBe(true);
  });
  it("tillåter *.github.io", () => {
    expect(isAllowedOrigin("https://ulrik-s.github.io")).toBe(true);
  });
  it("blockerar okänt + tom", () => {
    expect(isAllowedOrigin("https://evil.example.com")).toBe(false);
    expect(isAllowedOrigin("")).toBe(false);
  });
  it("tillåter extra origins (trimmade)", () => {
    expect(isAllowedOrigin("https://firma.ava.se", [" https://firma.ava.se "])).toBe(true);
    expect(isAllowedOrigin("https://firma.ava.se", ["https://annan.se"])).toBe(false);
  });
});
