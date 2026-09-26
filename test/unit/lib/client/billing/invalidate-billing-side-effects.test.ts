import { describe, expect, it, vi } from "vitest-compat";
import { invalidateBillingSideEffects } from "@/lib/client/billing/invalidate-billing-side-effects";

describe("invalidateBillingSideEffects (#1221)", () => {
  it("hämtar om Anteckningar och Att bevaka", () => {
    const serviceNote = vi.fn(async () => {});
    const watchlist = vi.fn(async () => {});
    invalidateBillingSideEffects({ serviceNote: { list: { invalidate: serviceNote } }, watchlist: { list: { invalidate: watchlist } } });
    expect(serviceNote).toHaveBeenCalledOnce();
    expect(watchlist).toHaveBeenCalledOnce();
  });
});
