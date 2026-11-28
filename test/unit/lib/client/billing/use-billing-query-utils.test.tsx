/**
 * `useBillingQueryUtils` (#1929): de smala invaliderings-sömmarna över den nya
 * bindningen. Varje söm invaliderar (eller hämtar om) just sin procedur, med
 * indata när den ges och för alla indata annars — som `useUtils()` gjorde.
 */
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest-compat";
import { invalidateBillingSideEffects, invalidateDocumentLists, invalidateUnbilledWork } from "@/lib/client/billing/invalidate-billing-side-effects";
import { useBillingQueryUtils } from "@/lib/client/billing/use-billing-query-utils";
import { asId } from "@/lib/shared/schemas/ids";
import { fakeTrpcLink, invalidatedPaths, testQueryClient, TrpcTestProvider } from "../../../../helpers/trpc-fake";

function setup() {
  const fake = fakeTrpcLink({});
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const refetch = vi.spyOn(queryClient, "refetchQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>{children}</TrpcTestProvider>
  );
  const { result, rerender } = renderHook(() => useBillingQueryUtils(), { wrapper });
  return { result, rerender, invalidate, refetch };
}

const m1 = asId<"MatterId">("m1");

describe("useBillingQueryUtils (#1929)", () => {
  it("faktureringens sidoeffekter: anteckningarna och Att bevaka", () => {
    const { result, invalidate } = setup();
    invalidateBillingSideEffects(result.current);
    expect(invalidatedPaths(invalidate)).toEqual(["serviceNote.list", "watchlist.list"]);
  });

  it("dokumentlistorna: listan och trädet, för alla ärenden", () => {
    const { result, invalidate } = setup();
    invalidateDocumentLists(result.current);
    expect(invalidatedPaths(invalidate)).toEqual(["document.list", "document.tree"]);
  });

  it("fakturaförslaget: per ärende, eller alla utan ärenden", () => {
    const { result, invalidate } = setup();
    invalidateUnbilledWork(result.current, [m1]);
    invalidateUnbilledWork(result.current);
    expect(invalidatedPaths(invalidate)).toEqual(["billingRun.proposal", 'billingRun.proposal {"matterId":"m1"}']);
  });

  it("dokumentträdet och listan med filter, och trädet hämtas om med samma filter", async () => {
    const { result, invalidate, refetch } = setup();
    await result.current.document.tree.invalidate({ matterId: m1 });
    await result.current.document.list.invalidate({ matterId: m1 });
    refetch.mockClear(); // invalidateQueries hämtar själv om aktiva frågor
    await result.current.document.tree.refetch({ matterId: m1 });
    expect(invalidatedPaths(invalidate)).toEqual(['document.list {"matterId":"m1"}', 'document.tree {"matterId":"m1"}']);
    expect(invalidatedPaths(refetch)).toEqual(['document.tree {"matterId":"m1"}']);
  });

  it("samma objekt mellan renderingar", () => {
    const { result, rerender } = setup();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
