/**
 * `useBillingShortcut` (#1854): läser `?fakturera=1` och tar bort parametern
 * ur adressen en gång per begäran.
 */

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest-compat";
import { useBillingShortcut } from "@/app/matters/[id]/_use-billing-shortcut";

const navigation = { search: new URLSearchParams(), replace: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace }),
  useSearchParams: () => navigation.search,
}));

beforeEach(() => {
  navigation.search = new URLSearchParams();
  navigation.replace = vi.fn();
});

describe("useBillingShortcut", () => {
  it("utan parametern: ingen begäran", () => {
    const { result } = renderHook(() => useBillingShortcut("m1"));
    expect(result.current.requested).toBe(false);
  });

  it("andra värden än 1 räknas inte som en begäran", () => {
    navigation.search = new URLSearchParams("id=m1&fakturera=0");
    const { result } = renderHook(() => useBillingShortcut("m1"));
    expect(result.current.requested).toBe(false);
  });

  it("med parametern: begäran, och done ersätter adressen bara en gång", () => {
    navigation.search = new URLSearchParams("id=m1&fakturera=1");
    const { result } = renderHook(() => useBillingShortcut("m1"));
    expect(result.current.requested).toBe(true);
    result.current.done();
    result.current.done();
    expect(navigation.replace).toHaveBeenCalledTimes(1);
    expect(navigation.replace).toHaveBeenCalledWith("/matters/__shell__/?id=m1");
  });

  it("en ny begäran efter att parametern försvunnit tas bort igen", () => {
    navigation.search = new URLSearchParams("id=m1&fakturera=1");
    const { result, rerender } = renderHook(() => useBillingShortcut("m1"));
    result.current.done();
    navigation.search = new URLSearchParams("id=m1");
    rerender();
    expect(result.current.requested).toBe(false);
    navigation.search = new URLSearchParams("id=m1&fakturera=1");
    rerender();
    result.current.done();
    expect(navigation.replace).toHaveBeenCalledTimes(2);
  });

  it("fakturera=FINAL ber om just slutfakturan (en omgjord faktura, #2260)", () => {
    navigation.search = new URLSearchParams("id=m1&fakturera=FINAL");
    const { result } = renderHook(() => useBillingShortcut("m1"));
    expect(result.current).toMatchObject({ requested: true, preferred: "FINAL" });
  });
});
