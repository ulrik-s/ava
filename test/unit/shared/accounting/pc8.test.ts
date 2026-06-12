import { describe, it, expect } from "vitest-compat";
import { encodePc8 } from "@/lib/shared/accounting/pc8";

const bytes = (s: string) => Array.from(encodePc8(s));

describe("encodePc8 (CP437)", () => {
  it("ASCII är oförändrat", () => {
    expect(bytes("ABC 0-9 #VER")).toEqual([...Buffer.from("ABC 0-9 #VER", "latin1")]);
  });

  it("svenska tecken mappas till CP437-bytes", () => {
    expect(bytes("ä")).toEqual([0x84]);
    expect(bytes("å")).toEqual([0x86]);
    expect(bytes("ö")).toEqual([0x94]);
    expect(bytes("Ä")).toEqual([0x8e]);
    expect(bytes("Å")).toEqual([0x8f]);
    expect(bytes("Ö")).toEqual([0x99]);
    expect(bytes("Kundfordringar")).toEqual([...Buffer.from("Kundfordringar", "latin1")]);
    expect(bytes("Utgående")).toEqual([0x55, 0x74, 0x67, 0x86, 0x65, 0x6e, 0x64, 0x65]);
  });

  it("ej-representerbara tecken → '?' (0x3F)", () => {
    expect(bytes("😀")).toEqual([0x3f, 0x3f]); // utanför BMP → två surrogat → två '?'
    expect(bytes("€")).toEqual([0x3f]); // euro finns inte i CP437
  });

  it("returnerar en Uint8Array av rätt längd (1 byte per UTF-16-enhet)", () => {
    const out = encodePc8("Aä");
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out.length).toBe(2);
  });
});
