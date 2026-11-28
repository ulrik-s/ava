/**
 * useHiddenPanels (#1611) — användarens lista över borttagna paneler per sida:
 * personlig preferens, lokal uppdatering direkt, och ingen hämtning alls när
 * sidan saknar valbara paneler.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";
import { useHiddenPanels } from "@/components/layout/use-hidden-panels";
import { callsTo } from "../../../helpers/trpc-both-fake";
import { fakeTrpcWrapper, invalidatedPaths, never } from "../../../helpers/trpc-fake";

let stored: { user: unknown; org: unknown } | undefined;

/** Kör hooken under en fejkad länk; utan `stored` svarar `prefs.get` aldrig (laddar). */
async function renderPanels(page: string, closable: readonly string[]) {
  const w = fakeTrpcWrapper({ "prefs.get": () => stored ?? never(), "prefs.save": () => ({}) });
  const invalidate = vi.spyOn(w.queryClient, "invalidateQueries");
  const view = renderHook(() => useHiddenPanels(page, closable), { wrapper: w.wrapper });
  if (stored && closable.length > 0) await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return { ...w, ...view, invalidate };
}

/** Indata till `prefs.save`, i ordning. */
const saves = (w: Awaited<ReturnType<typeof renderPanels>>): unknown[] => callsTo(w.fake, "prefs.save");

beforeEach(() => {
  stored = { user: { hidden: ["b"] }, org: { hidden: ["a"] } };
});

describe("useHiddenPanels", () => {
  it("läser bara användarens lista under sidans nyckel", async () => {
    const view = await renderPanels("dashboard", ["a", "b"]);
    expect(view.result.current.hidden).toEqual(["b"]);
    expect(callsTo(view.fake, "prefs.get")).toEqual([{ key: "panels.dashboard.hidden" }]);
  });

  it("utan valbara paneler hämtas inget", async () => {
    const view = await renderPanels("matter", []);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(callsTo(view.fake, "prefs.get")).toEqual([]);
    expect(view.result.current.hidden).toEqual([]);
  });

  it("laddning syns", async () => {
    stored = undefined;
    const view = await renderPanels("dashboard", ["a"]);
    expect(view.result.current.isLoading).toBe(true);
  });

  it("hide sparar och uppdaterar lokalt direkt; samma id två gånger sparas en gång", async () => {
    const view = await renderPanels("dashboard", ["a", "b"]);
    act(() => view.result.current.hide("a"));
    expect(view.result.current.hidden).toEqual(["b", "a"]);
    act(() => view.result.current.hide("a"));
    await waitFor(() => expect(view.queryClient.isMutating()).toBe(0));
    expect(saves(view)).toEqual([{ key: "panels.dashboard.hidden", prefs: { hidden: ["b", "a"] } }]);
  });

  it("show lägger tillbaka en dold panel; en synlig rörs inte", async () => {
    const view = await renderPanels("dashboard", ["a", "b"]);
    act(() => view.result.current.show("a"));
    expect(saves(view)).toEqual([]);
    act(() => view.result.current.show("b"));
    expect(view.result.current.hidden).toEqual([]);
    await waitFor(() => expect(saves(view)).toEqual([{ key: "panels.dashboard.hidden", prefs: { hidden: [] } }]));
  });

  // #1612: utan omhämtning visade sidan den gamla listan efter navigering.
  it("efter sparning hämtas preferensen om", async () => {
    const view = await renderPanels("dashboard", ["a", "b"]);
    act(() => view.result.current.hide("a"));
    await waitFor(() => expect(invalidatedPaths(view.invalidate)).toEqual(['prefs.get {"key":"panels.dashboard.hidden"}']));
  });
});
