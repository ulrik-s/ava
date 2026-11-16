/**
 * useHiddenPanels (#1611) — användarens lista över borttagna paneler per sida:
 * personlig preferens, lokal uppdatering direkt, och ingen hämtning alls när
 * sidan saknar valbara paneler.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

const stored: { data: { user: unknown; org: unknown } | undefined; isLoading: boolean } = { data: undefined, isLoading: false };
const useQuery = vi.fn((_input: { key: string }, _opts: { enabled: boolean }) => stored);
const save = vi.fn();

vi.mock("@/lib/client/trpc", () => ({
  trpc: { prefs: { get: { useQuery }, save: { useMutation: () => ({ mutate: save }) } } },
}));

const { useHiddenPanels } = await import("@/components/layout/use-hidden-panels");

beforeEach(() => {
  vi.clearAllMocks();
  stored.data = { user: { hidden: ["b"] }, org: { hidden: ["a"] } };
  stored.isLoading = false;
});

describe("useHiddenPanels", () => {
  it("läser bara användarens lista under sidans nyckel", () => {
    const { result } = renderHook(() => useHiddenPanels("dashboard", ["a", "b"]));
    expect(result.current.hidden).toEqual(["b"]);
    expect(useQuery).toHaveBeenCalledWith({ key: "panels.dashboard.hidden" }, { enabled: true });
  });

  it("utan valbara paneler hämtas inget", () => {
    stored.data = undefined;
    const { result } = renderHook(() => useHiddenPanels("matter", []));
    expect(useQuery).toHaveBeenCalledWith({ key: "panels.matter.hidden" }, { enabled: false });
    expect(result.current.hidden).toEqual([]);
  });

  it("laddning syns", () => {
    stored.isLoading = true;
    const { result } = renderHook(() => useHiddenPanels("dashboard", ["a"]));
    expect(result.current.isLoading).toBe(true);
  });

  it("hide sparar och uppdaterar lokalt direkt; samma id två gånger sparas en gång", () => {
    const { result } = renderHook(() => useHiddenPanels("dashboard", ["a", "b"]));
    act(() => result.current.hide("a"));
    expect(result.current.hidden).toEqual(["b", "a"]);
    act(() => result.current.hide("a"));
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith({ key: "panels.dashboard.hidden", prefs: { hidden: ["b", "a"] } });
  });

  it("show lägger tillbaka en dold panel; en synlig rörs inte", () => {
    const { result } = renderHook(() => useHiddenPanels("dashboard", ["a", "b"]));
    act(() => result.current.show("a"));
    expect(save).not.toHaveBeenCalled();
    act(() => result.current.show("b"));
    expect(result.current.hidden).toEqual([]);
    expect(save).toHaveBeenCalledWith({ key: "panels.dashboard.hidden", prefs: { hidden: [] } });
  });
});
