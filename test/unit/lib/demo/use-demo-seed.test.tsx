/**
 * Tester för `useDemoSeed` — hook:en som /demo-routen använder för att ladda
 * en DemoSource direkt (#420). Verifierar state-övergångar + felhantering.
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect } from "vitest-compat";
import { useDemoSeed } from "@/lib/client/demo/use-demo-seed";
import type { DemoSource } from "@/lib/shared/demo-source";

describe("useDemoSeed", () => {
  it("startar idle och blir loaded med source vid lyckad load", async () => {
    const source: DemoSource = { matters: [{ id: "m1" }] };
    const { result } = renderHook(() => useDemoSeed(() => Promise.resolve(source)));
    expect(result.current.status).toBe("idle");

    await act(async () => { await result.current.loadDemo("x/r"); });

    await waitFor(() => expect(result.current.status).toBe("loaded"));
    expect(result.current.source.matters).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("sätter error + status=error vid ladd-fel och re-kastar", async () => {
    const { result } = renderHook(() =>
      useDemoSeed(() => Promise.reject(new Error("boom"))),
    );

    await act(async () => {
      await expect(result.current.loadDemo("x/r")).rejects.toThrow("boom");
    });

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.error?.message).toBe("boom");
  });
});
