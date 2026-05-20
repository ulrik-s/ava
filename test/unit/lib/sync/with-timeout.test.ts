/**
 * Tester för `withTimeout` — kritisk byggsten i auto-sync. Måste:
 *   - resolvera om underliggande promise hinner
 *   - rejecta med SyncTimeoutError om tiden går ut
 *   - cleara timern så vi inte läcker timers
 */

import { describe, it, expect, vi } from "vitest";
import { withTimeout, SyncTimeoutError } from "@/lib/sync/with-timeout";

describe("withTimeout", () => {
  it("resolvar om promise hinner före timeout", async () => {
    const p = Promise.resolve(42);
    await expect(withTimeout(p, 1000, "test")).resolves.toBe(42);
  });

  it("kastar SyncTimeoutError om timer går ut före promise", async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 100));
    await expect(withTimeout(slow, 10, "test-op")).rejects.toBeInstanceOf(SyncTimeoutError);
  });

  it("rejection-message innehåller label + ms", async () => {
    const slow = new Promise<number>((resolve) => setTimeout(() => resolve(1), 100));
    try {
      await withTimeout(slow, 10, "git pull");
    } catch (e) {
      expect((e as Error).message).toContain("git pull");
      expect((e as Error).message).toContain("10");
    }
  });

  it("clearar timer efter resolution (ingen orphan)", async () => {
    vi.useFakeTimers();
    try {
      const p = Promise.resolve("done");
      await withTimeout(p, 5000, "x");
      // Inga timers ska vara väntande
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejectar om underliggande promise kastar", async () => {
    const failed = Promise.reject(new Error("network down"));
    await expect(withTimeout(failed, 1000, "test")).rejects.toThrow("network down");
  });
});
