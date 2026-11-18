/**
 * Tidpostformulärets datum (#1677): den svenska kalenderdagen — inte UTC-dygnet
 * ur `toISOString()`, som gav gårdagen mellan 00 och 01 (02 sommartid).
 */
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { emptyForm, toEditForm } from "@/components/time/time-entry-form";

afterEach(() => {
  vi.setSystemTime();
});

describe("tidpostformulärets datum", () => {
  it("en ny post får dagens svenska datum — nyårsnatten 00:30 är den 1 januari", () => {
    vi.setSystemTime(new Date("2025-12-31T23:30:00Z"));
    expect(emptyForm().date).toBe("2026-01-01");
  });

  it("en sparad post visar sin svenska dag, också när den sparats som svensk midnatt", () => {
    const entry = { minutes: 30, description: null, billable: true };
    expect(toEditForm({ ...entry, date: new Date("2026-06-30T22:00:00Z") }).date).toBe("2026-07-01");
    expect(toEditForm({ ...entry, date: "2026-01-15" }).date).toBe("2026-01-15");
  });
});
