/**
 * Test för Bankgiro-OCR-referensen (#182): mod-10-kontrollsiffra (Luhn),
 * längdsiffra och härledning ur fakturanummer (F-YYYY-NNNN, #167).
 */

import { describe, it, expect } from "vitest-compat";

import {
  mod10CheckDigit,
  buildOcrReference,
  isValidOcrReference,
  ocrFromInvoiceNumber,
} from "@/lib/shared/ocr-reference";

describe("mod10CheckDigit (Luhn)", () => {
  // Kända Luhn-vektorer: kontrollsiffran som gör hela strängen Luhn-giltig.
  it("kända vektorer", () => {
    expect(mod10CheckDigit("7992739871")).toBe(3); // klassisk exempelvektor
    expect(mod10CheckDigit("1212121212")).toBe(5);
    expect(mod10CheckDigit("0")).toBe(0);
    expect(mod10CheckDigit("9")).toBe(1); // 9*2=18 → 18-9=9 → (10-9)%10 = 1
  });

  it("kastar på icke-siffror", () => {
    expect(() => mod10CheckDigit("12a4")).toThrow(/siffror/);
    expect(() => mod10CheckDigit("")).toThrow(/siffror/);
  });
});

describe("buildOcrReference", () => {
  it("bygger kärna + längdsiffra + kontrollsiffra", () => {
    const ocr = buildOcrReference("20260001");
    expect(ocr).toHaveLength(10);
    expect(ocr.startsWith("20260001")).toBe(true);
    expect(ocr[8]).toBe("0"); // längdsiffra: 10 % 10 = 0
    expect(isValidOcrReference(ocr)).toBe(true);
  });

  it("deterministisk: samma kärna → samma OCR", () => {
    expect(buildOcrReference("20260001")).toBe(buildOcrReference("20260001"));
  });

  it("kastar på icke-numerisk kärna", () => {
    expect(() => buildOcrReference("F-2026")).toThrow(/numerisk/);
  });
});

describe("isValidOcrReference", () => {
  it("accepterar byggda referenser och förkastar manipulerade", () => {
    const ocr = buildOcrReference("20260042");
    expect(isValidOcrReference(ocr)).toBe(true);
    // Flippa kontrollsiffran → ogiltig.
    const last = Number(ocr[ocr.length - 1]);
    const tampered = ocr.slice(0, -1) + String((last + 1) % 10);
    expect(isValidOcrReference(tampered)).toBe(false);
  });

  it("förkastar fel längdsiffra, icke-siffror och för korta", () => {
    expect(isValidOcrReference("123")).toBe(false);
    expect(isValidOcrReference("abc1234567")).toBe(false);
    // Giltig checksiffra men fel längdsiffra: bygg om med fel längdsiffra.
    const core = "2026000199"; // 10 tecken: kärna+fel längdsiffra(9)
    const fake = core + String(mod10CheckDigit(core));
    expect(fake).toHaveLength(11);
    expect(isValidOcrReference(fake)).toBe(false); // längdsiffra 9 ≠ 11 % 10
  });
});

describe("ocrFromInvoiceNumber", () => {
  it("härleder ur F-YYYY-NNNN", () => {
    const ocr = ocrFromInvoiceNumber("F-2026-0001");
    expect(ocr).not.toBeNull();
    expect(ocr).toBe(buildOcrReference("20260001"));
    expect(isValidOcrReference(ocr as string)).toBe(true);
  });

  it("null för saknat/icke-parsbart nummer (kostnadsräkningar har inget)", () => {
    expect(ocrFromInvoiceNumber(null)).toBeNull();
    expect(ocrFromInvoiceNumber(undefined)).toBeNull();
    expect(ocrFromInvoiceNumber("")).toBeNull();
    expect(ocrFromInvoiceNumber("UTAN-NUMMER-")).toBeNull();
  });
});
