import { describe, expect, it, vi } from "vitest-compat";
import { invalidateBillingSideEffects, invalidateDocumentLists } from "@/lib/client/billing/invalidate-billing-side-effects";

describe("invalidateBillingSideEffects (#1221)", () => {
  it("hämtar om Anteckningar och Att bevaka", () => {
    const serviceNote = vi.fn(async () => {});
    const watchlist = vi.fn(async () => {});
    invalidateBillingSideEffects({ serviceNote: { list: { invalidate: serviceNote } }, watchlist: { list: { invalidate: watchlist } } });
    expect(serviceNote).toHaveBeenCalledOnce();
    expect(watchlist).toHaveBeenCalledOnce();
  });
});

describe("invalidateDocumentLists (#1230)", () => {
  it("hämtar om dokumentlistan och dokumentträdet", () => {
    const list = vi.fn(async () => {});
    const tree = vi.fn(async () => {});
    invalidateDocumentLists({ document: { list: { invalidate: list }, tree: { invalidate: tree } } });
    expect(list).toHaveBeenCalledOnce();
    expect(tree).toHaveBeenCalledOnce();
  });
});
