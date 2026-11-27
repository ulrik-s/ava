/**
 * Övergångarna efter SENT, en och en. Mutationstestningen visade att
 * `PAID: ["CANCELLED"]` och `BAD_DEBT: ["PAID", "CANCELLED"]` kunde tömmas utan
 * att något test fällde — ingen kontrollerade att en betald faktura går att
 * kreditera, eller att en kundförlust kan betalas in eller krediteras.
 */
import { describe, expect, it } from "vitest-compat";
import { canTransition, REQUIRES_SENT } from "@/lib/shared/billing/invoice-state-machine";

describe("fakturornas övergångar efter SENT", () => {
  it("en betald faktura kan krediteras (PAID → CANCELLED), men inte gå tillbaka", () => {
    expect(canTransition("PAID", "CANCELLED")).toBe(true);
    expect(canTransition("PAID", "SENT")).toBe(false);
    expect(canTransition("PAID", "BAD_DEBT")).toBe(false);
  });

  it("en kundförlust kan betalas in sent (→ PAID) eller krediteras (→ CANCELLED)", () => {
    expect(canTransition("BAD_DEBT", "PAID")).toBe(true);
    expect(canTransition("BAD_DEBT", "CANCELLED")).toBe(true);
    expect(canTransition("BAD_DEBT", "SENT")).toBe(false);
  });

  it("REQUIRES_SENT är exakt de tillstånd som bara nås via SENT", () => {
    expect([...REQUIRES_SENT].sort()).toEqual(["BAD_DEBT", "INSTALLMENT_PLAN", "PAID"]);
    for (const s of REQUIRES_SENT) {
      expect(canTransition("DRAFT", s)).toBe(false);
      expect(canTransition("SENT", s)).toBe(true);
    }
  });
});
