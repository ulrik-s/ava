/**
 * useTimeChartView (#2111) — personens förvalda vy i rutan Stapeldiagram:
 * läses ur `prefs` under `chart.time`, byts lokalt direkt och sparas.
 */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

const stored: { data: { user: unknown; org: unknown } | undefined } = { data: undefined };
const useQuery = vi.fn((_input: { key: string }) => stored);
const save = vi.fn();
const invalidate = vi.fn(() => Promise.resolve());
const mutate = (input: unknown, opts?: { onSuccess?: () => void }): void => { save(input); opts?.onSuccess?.(); };

vi.mock("@/lib/client/trpc", () => ({
  trpc: {
    useUtils: () => ({ prefs: { get: { invalidate } } }),
    prefs: { get: { useQuery }, save: { useMutation: () => ({ mutate }) } },
  },
}));

const { useTimeChartView } = await import("@/components/time/use-time-chart-view");

beforeEach(() => {
  vi.clearAllMocks();
  stored.data = undefined;
});

describe("useTimeChartView", () => {
  it("visar Vecka till dess inställningen lästs, under nyckeln chart.time", () => {
    const { result } = renderHook(() => useTimeChartView());
    expect(result.current[0]).toBe("week");
    expect(useQuery).toHaveBeenCalledWith({ key: "chart.time" });
  });

  it("läser personens sparade vy, inte byråns", () => {
    stored.data = { user: { view: "month" }, org: { view: "year" } };
    const { result } = renderHook(() => useTimeChartView());
    expect(result.current[0]).toBe("month");
  });

  it("ett ogiltigt värde ger Vecka", () => {
    stored.data = { user: { view: "decade" }, org: null };
    const { result } = renderHook(() => useTimeChartView());
    expect(result.current[0]).toBe("week");
  });

  it("ett byte syns direkt, sparas och läser om nyckeln", () => {
    const { result } = renderHook(() => useTimeChartView());
    act(() => result.current[1]("year"));
    expect(result.current[0]).toBe("year");
    expect(save).toHaveBeenCalledWith({ key: "chart.time", prefs: { view: "year" } });
    expect(invalidate).toHaveBeenCalledWith({ key: "chart.time" });
  });
});
