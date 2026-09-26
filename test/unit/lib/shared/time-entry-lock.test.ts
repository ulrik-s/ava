/**
 * `isLockedEntry` (#1205) — EN låsregel för redan redovisade/fakturerade poster.
 */
import { describe, expect, it } from "vitest-compat";
import { asId } from "@/lib/shared/schemas/ids";
import { isLockedEntry } from "@/lib/shared/time-entry-lock";

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
