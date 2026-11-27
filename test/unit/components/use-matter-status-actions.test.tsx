/**
 * Ärendets statusåtgärder (#2100): Avsluta frågar först, Återöppna och Behåll
 * som aktivt gör det direkt, och varje lyckat anrop läser om ärendet och Att
 * åtgärda.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { useMatterStatusActions } from "@/components/matter/use-matter-status-actions";
import { fakeTrpcLink, testQueryClient, TrpcTestProvider, type TrpcHandlers } from "../../helpers/trpc-fake";

function setup(handlers: TrpcHandlers = {
  "matter.update": () => ({ id: "m1" }),
  "matter.keepActive": () => ({ id: "m1" }),
}) {
  const fake = fakeTrpcLink(handlers);
  const queryClient = testQueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TrpcTestProvider link={fake.link} queryClient={queryClient}>{children}</TrpcTestProvider>
  );
  const { result } = renderHook(() => useMatterStatusActions(), { wrapper });
  return { fake, invalidate, result };
}

/** Procedurvägarna i invalideringarna, t.ex. "matter.getById {"id":"m1"}". */
function invalidated(spy: { mock: { calls: ReadonlyArray<readonly unknown[]> } }): string[] {
  return spy.mock.calls.map((c) => {
    const key = (c[0] as { queryKey?: unknown[] } | undefined)?.queryKey ?? [];
    const path = (key[0] as string[] | undefined)?.join(".") ?? "";
    const input = (key[1] as { input?: unknown } | undefined)?.input;
    return input === undefined ? path : `${path} ${JSON.stringify(input)}`;
  }).sort();
}

const EXPECTED_INVALIDATIONS = ["matter.getById {\"id\":\"m1\"}", "watchlist.actionItems"];

afterEach(() => { vi.restoreAllMocks(); });

describe("useMatterStatusActions (#2100)", () => {
  it("Avsluta frågar med ärendets titel; Avbryt gör ingenting", () => {
    const ask = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { fake, result } = setup();
    act(() => { result.current.close({ id: "m1", title: "Vårdnadstvist" }); });
    expect(ask).toHaveBeenCalledWith("Avsluta ärendet \"Vårdnadstvist\"? Det går att återöppna sen.");
    expect(fake.calls).toEqual([]);
  });

  it("Avsluta med ja gör ärendet Stängt och läser om ärendet och Att åtgärda", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { fake, invalidate, result } = setup();
    act(() => { result.current.close({ id: "m1", title: "Vårdnadstvist" }); });
    await waitFor(() => expect(invalidated(invalidate)).toEqual(EXPECTED_INVALIDATIONS));
    expect(fake.calls).toEqual([{ path: "matter.update", type: "mutation", input: { id: "m1", status: "CLOSED" } }]);
  });

  it("Återöppna frågar ingenting och gör ärendet Aktivt", async () => {
    const ask = vi.spyOn(window, "confirm");
    const { fake, invalidate, result } = setup();
    act(() => { result.current.reopen("m1"); });
    await waitFor(() => expect(invalidated(invalidate)).toEqual(EXPECTED_INVALIDATIONS));
    expect(ask).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([{ path: "matter.update", type: "mutation", input: { id: "m1", status: "ACTIVE" } }]);
  });

  it("Behåll som aktivt frågar ingenting och anropar matter.keepActive", async () => {
    const ask = vi.spyOn(window, "confirm");
    const { fake, invalidate, result } = setup();
    act(() => { result.current.keepActive("m1"); });
    await waitFor(() => expect(invalidated(invalidate)).toEqual(EXPECTED_INVALIDATIONS));
    expect(ask).not.toHaveBeenCalled();
    expect(fake.calls).toEqual([{ path: "matter.keepActive", type: "mutation", input: { id: "m1" } }]);
  });

  it("isPending speglar ett pågående anrop", async () => {
    let release: () => void = () => {};
    const { result } = setup({
      "matter.keepActive": () => new Promise((resolve) => { release = () => resolve({ id: "m1" }); }),
    });
    expect(result.current.isPending).toBe(false);
    act(() => { result.current.keepActive("m1"); });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    act(() => { release(); });
    await waitFor(() => expect(result.current.isPending).toBe(false));
  });

  it("ett misslyckat anrop invaliderar ingenting", async () => {
    const { fake, invalidate, result } = setup({});
    act(() => { result.current.keepActive("m1"); });
    await waitFor(() => expect(fake.calls).toHaveLength(1));
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(invalidate).not.toHaveBeenCalled();
  });
});
