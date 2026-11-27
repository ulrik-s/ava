import { describe, expect, it, vi } from "vitest-compat";
import { invalidateBillingSideEffects, invalidateDocumentLists, invalidateUnbilledWork } from "@/lib/client/billing/invalidate-billing-side-effects";
import { asId } from "@/lib/shared/schemas/ids";

describe("invalidateBillingSideEffects (#1221)", () => {
  it("hämtar om Anteckningar och Frister", () => {
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

describe("invalidateUnbilledWork (#2201)", () => {
  const setup = () => {
    const invalidate = vi.fn(async (_input?: { matterId: string }) => {});
    return { invalidate, utils: { billingRun: { proposal: { invalidate } } } };
  };

  it("ett ärende: hämtar om det ärendets förslag", () => {
    const { invalidate, utils } = setup();
    invalidateUnbilledWork(utils, [asId<"MatterId">("m1")]);
    expect(invalidate.mock.calls).toEqual([[{ matterId: "m1" }]]);
  });

  it("två ärenden: hämtar om båda (en flytt)", () => {
    const { invalidate, utils } = setup();
    invalidateUnbilledWork(utils, [asId<"MatterId">("m1"), asId<"MatterId">("m2")]);
    expect(invalidate.mock.calls).toEqual([[{ matterId: "m1" }], [{ matterId: "m2" }]]);
  });

  it("inga ärenden: hämtar om alla ärendens förslag, utan indata", () => {
    const { invalidate, utils } = setup();
    invalidateUnbilledWork(utils);
    expect(invalidate.mock.calls).toEqual([[]]);
  });
});
