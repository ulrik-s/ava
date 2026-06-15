/**
 * Tester för fakturornas tillståndsmaskin (#350, ADR 0015). Bevisar att varje
 * tillåten övergång accepteras och varje förbjuden avvisas — särskilt att
 * `PAID`/`INSTALLMENT_PLAN`/`BAD_DEBT` inte kan nås direkt från `DRAFT`.
 */

import { describe, it, expect } from "vitest-compat";
import {
  canTransition,
  assertInvoiceTransition,
  transitionErrorMessage,
  INVOICE_TRANSITIONS,
  REQUIRES_SENT,
} from "@/lib/shared/invoice-state-machine";
import type { InvoiceStatus } from "@/lib/shared/schemas/enums";

const ALL: InvoiceStatus[] = ["DRAFT", "SENT", "PAID", "CANCELLED", "BAD_DEBT", "INSTALLMENT_PLAN"];

describe("canTransition — tillåtna övergångar", () => {
  it("DRAFT → SENT och DRAFT → CANCELLED", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(true);
    expect(canTransition("DRAFT", "CANCELLED")).toBe(true);
  });

  it("SENT → PAID / INSTALLMENT_PLAN / BAD_DEBT / CANCELLED", () => {
    for (const to of ["PAID", "INSTALLMENT_PLAN", "BAD_DEBT", "CANCELLED"] as InvoiceStatus[]) {
      expect(canTransition("SENT", to)).toBe(true);
    }
  });

  it("INSTALLMENT_PLAN → PAID / SENT (avbruten plan) / BAD_DEBT / CANCELLED", () => {
    for (const to of ["PAID", "SENT", "BAD_DEBT", "CANCELLED"] as InvoiceStatus[]) {
      expect(canTransition("INSTALLMENT_PLAN", to)).toBe(true);
    }
  });

  it("samma tillstånd är alltid en no-op-övergång", () => {
    for (const s of ALL) expect(canTransition(s, s)).toBe(true);
  });
});

describe("canTransition — förbjudna övergångar (invarianter)", () => {
  it("DRAFT kan ALDRIG hoppa direkt till PAID/INSTALLMENT_PLAN/BAD_DEBT", () => {
    for (const to of REQUIRES_SENT) {
      expect(canTransition("DRAFT", to)).toBe(false);
    }
  });

  it("CANCELLED är terminalt (inga utgående övergångar)", () => {
    for (const to of ALL.filter((s) => s !== "CANCELLED")) {
      expect(canTransition("CANCELLED", to)).toBe(false);
    }
    expect(INVOICE_TRANSITIONS.CANCELLED).toHaveLength(0);
  });

  it("PAID kan inte gå tillbaka till SENT/DRAFT/INSTALLMENT_PLAN", () => {
    for (const to of ["SENT", "DRAFT", "INSTALLMENT_PLAN"] as InvoiceStatus[]) {
      expect(canTransition("PAID", to)).toBe(false);
    }
  });

  it("REQUIRES_SENT-tillstånd nås aldrig från DRAFT i transitionskartan", () => {
    for (const to of REQUIRES_SENT) {
      expect(INVOICE_TRANSITIONS.DRAFT).not.toContain(to);
    }
  });
});

describe("assertInvoiceTransition", () => {
  it("kastar inte för en tillåten övergång", () => {
    expect(() => assertInvoiceTransition("SENT", "PAID")).not.toThrow();
  });

  it("kastar med beskrivande meddelande för en förbjuden övergång", () => {
    expect(() => assertInvoiceTransition("DRAFT", "PAID")).toThrow(/DRAFT → PAID/);
  });
});

describe("transitionErrorMessage", () => {
  it("listar tillåtna mål från utgångstillståndet", () => {
    const msg = transitionErrorMessage("DRAFT", "PAID");
    expect(msg).toMatch(/SENT/);
    expect(msg).toMatch(/CANCELLED/);
    expect(msg).not.toMatch(/INSTALLMENT_PLAN/); // ej tillåtet från DRAFT
  });
});
