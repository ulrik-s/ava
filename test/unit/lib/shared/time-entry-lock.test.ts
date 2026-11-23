/**
 * `isLockedEntry` (#1205, #1862) — EN låsregel för redan redovisade/fakturerade poster.
 */
import { describe, expect, it } from "vitest-compat";
import { asId } from "@/lib/shared/schemas/ids";
import { BILLING_LOCK_FIELDS, hasInvoice, isLockedEntry, unlockedMatch } from "@/lib/shared/time-entry-lock";

const run = asId<"BillingRunId">("run-1");
const other = asId<"BillingRunId">("run-2");

describe("isLockedEntry", () => {
  it("ofryst post är inte låst", () => {
    expect(isLockedEntry({})).toBe(false);
    expect(isLockedEntry({ frozenAt: null, frozenByBillingRunId: null })).toBe(false);
  });

  it("låst direkt mot en faktura (frozenAt utan körning — rådgivningstimmen) är låst", () => {
    expect(isLockedEntry({ frozenAt: "2026-05-10" })).toBe(true);
    expect(isLockedEntry({ frozenAt: new Date("2026-05-10"), frozenByBillingRunId: null }, run)).toBe(true);
  });

  it("fryst av en körning är låst", () => {
    expect(isLockedEntry({ frozenAt: "2026-05-10", frozenByBillingRunId: run })).toBe(true);
    expect(isLockedEntry({ frozenByBillingRunId: run })).toBe(true);
  });

  it("fryst av den EGNA körningen är dess underlag, inte låst", () => {
    expect(isLockedEntry({ frozenAt: "2026-05-10", frozenByBillingRunId: run }, run)).toBe(false);
    expect(isLockedEntry({ frozenAt: "2026-05-10", frozenByBillingRunId: other }, run)).toBe(true);
  });
});

/** Alla 8 kombinationer av låsfälten (#1862): låst när något av dem är satt. */
const COMBOS = [false, true].flatMap((inv) => [false, true].flatMap((frozen) => [false, true].map((byRun) => ({ inv, frozen, byRun }))));

const entryOf = (c: { inv: boolean; frozen: boolean; byRun: boolean }, runId = run) => ({
  invoiceId: c.inv ? "inv-1" : null,
  frozenAt: c.frozen ? "2026-05-10" : null,
  frozenByBillingRunId: c.byRun ? runId : null,
});

describe("isLockedEntry — tabell över BILLING_LOCK_FIELDS (#1862)", () => {
  it("listan har de tre fälten", () => {
    expect([...BILLING_LOCK_FIELDS]).toEqual(["invoiceId", "frozenAt", "frozenByBillingRunId"]);
  });

  for (const c of COMBOS) {
    const locked = c.inv || c.frozen || c.byRun;
    it(`invoiceId=${String(c.inv)} frozenAt=${String(c.frozen)} körning=${String(c.byRun)} → ${locked ? "låst" : "olåst"}`, () => {
      expect(isLockedEntry(entryOf(c))).toBe(locked);
      // En annan körning ändrar inget.
      expect(isLockedEntry(entryOf(c), other)).toBe(locked);
      // Den egna körningens undantag prövas först: en post den frös är alltid olåst.
      expect(isLockedEntry(entryOf(c), run)).toBe(c.byRun ? false : locked);
    });
  }
});

describe("unlockedMatch", () => {
  it("alla låsfält och deletedAt är null", () => {
    expect(unlockedMatch()).toEqual({ invoiceId: null, frozenAt: null, frozenByBillingRunId: null, deletedAt: null });
  });
});

describe("hasInvoice", () => {
  it("bara invoiceId räknas, inte frysningen", () => {
    expect(hasInvoice({ invoiceId: "inv-1" })).toBe(true);
    expect(hasInvoice({ invoiceId: null })).toBe(false);
    expect(hasInvoice({})).toBe(false);
  });
});
