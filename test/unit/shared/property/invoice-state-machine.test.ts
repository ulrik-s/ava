/**
 * Egenskapstester (fast-check) för fakturornas tillståndsmaskin (#350, ADR 0015).
 *
 * I stället för att lista övergångar prövas maskinens invarianter mot
 * slumpade FÖRLOPP: tusentals sekvenser av försök att byta status, där bara de
 * tillåtna genomförs. Ett förlopp når aldrig Betald/Avbetalningsplan/Kundförlust
 * utan att ha passerat Skickad, Annullerad är en återvändsgränd och en
 * utställd faktura blir aldrig Skapad igen.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest-compat";
import {
  assertInvoiceTransition, canTransition, isIssued, REQUIRES_SENT, transitionErrorMessage,
} from "@/lib/shared/invoice-state-machine";
import { invoiceStatusSchema, type InvoiceStatus } from "@/lib/shared/schemas/enums";

const statuses = invoiceStatusSchema.options;
const status = fc.constantFrom(...statuses);

/** Ett förlopp: från Skapad, varje försök genomförs bara om övergången är tillåten. */
function walk(attempts: readonly InvoiceStatus[]): InvoiceStatus[] {
  const path: InvoiceStatus[] = ["DRAFT"];
  for (const to of attempts) {
    const from = path[path.length - 1] ?? "DRAFT";
    if (canTransition(from, to)) path.push(to);
  }
  return path;
}

const attempts = fc.array(status, { maxLength: 40 });

describe("förlopp genom tillståndsmaskinen", () => {
  it("Betald, Avbetalningsplan och Kundförlust nås aldrig utan att ha passerat Skickad", () => {
    fc.assert(fc.property(attempts, (as) => {
      const path = walk(as);
      const firstRequiringSent = path.findIndex((s) => REQUIRES_SENT.includes(s));
      if (firstRequiringSent >= 0) expect(path.slice(0, firstRequiringSent)).toContain("SENT");
    }));
  });

  it("Annullerad är terminalt: efter den första annulleringen händer inget mer", () => {
    fc.assert(fc.property(attempts, (as) => {
      const path = walk(as);
      const cancelled = path.indexOf("CANCELLED");
      if (cancelled >= 0) expect(new Set(path.slice(cancelled))).toEqual(new Set(["CANCELLED"]));
    }));
  });

  it("en utställd faktura blir aldrig Skapad igen", () => {
    fc.assert(fc.property(attempts, (as) => {
      const path = walk(as);
      const issued = path.findIndex(isIssued);
      if (issued >= 0) expect(path.slice(issued)).not.toContain("DRAFT");
    }));
  });
});

describe("canTransition / assertInvoiceTransition", () => {
  it("samma tillstånd är alltid tillåtet (idempotens)", () => {
    fc.assert(fc.property(status, (s) => {
      expect(canTransition(s, s)).toBe(true);
    }));
  });

  it("från Annullerad leder bara Annullerad; till Skapad leder bara Skapad", () => {
    fc.assert(fc.property(status, (s) => {
      expect(canTransition("CANCELLED", s)).toBe(s === "CANCELLED");
      expect(canTransition(s, "DRAFT")).toBe(s === "DRAFT");
    }));
  });

  it("assert kastar exakt när övergången inte är tillåten, med båda tillstånden i felet", () => {
    fc.assert(fc.property(status, status, (from, to) => {
      if (canTransition(from, to)) {
        expect(() => { assertInvoiceTransition(from, to); }).not.toThrow();
      } else {
        expect(() => { assertInvoiceTransition(from, to); }).toThrow(transitionErrorMessage(from, to));
        expect(transitionErrorMessage(from, to)).toContain(`${from} → ${to}`);
      }
    }));
  });
});

describe("isIssued (#1676)", () => {
  it("är exakt: varken Skapad eller Annullerad", () => {
    fc.assert(fc.property(status, (s) => {
      expect(isIssued(s)).toBe(s !== "DRAFT" && s !== "CANCELLED");
    }));
  });

  it("en sträng som inte är en status räknas aldrig som utställd", () => {
    fc.assert(fc.property(fc.string(), (s) => {
      fc.pre(!(statuses as readonly string[]).includes(s));
      expect(isIssued(s)).toBe(false);
    }));
  });
});
