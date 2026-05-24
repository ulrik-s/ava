/**
 * Tester för `useMediaQuery`-hooken.
 *
 * Mockar `window.matchMedia` så vi kan kontrollera state utan en riktig
 * browser-resize.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useMediaQuery } from "@/client/lib/use-media-query";

interface MQL {
  matches: boolean;
  media: string;
  addEventListener: (e: string, cb: (ev: { matches: boolean }) => void) => void;
  removeEventListener: (e: string, cb: (ev: { matches: boolean }) => void) => void;
}

function mockMatchMedia(initialMatches: boolean): { trigger: (matches: boolean) => void } {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  let currentMatches = initialMatches;
  const mql: MQL = {
    get matches() { return currentMatches; },
    media: "",
    addEventListener: (_e, cb) => listeners.add(cb),
    removeEventListener: (_e, cb) => listeners.delete(cb),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mql));
  return {
    trigger: (matches: boolean) => {
      currentMatches = matches;
      listeners.forEach((cb) => cb({ matches }));
    },
  };
}

describe("useMediaQuery", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("returnerar initial-värdet från matchMedia", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(true);
  });

  it("uppdaterar när mediaquery-state ändras", () => {
    const ctrl = mockMatchMedia(false);
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)"));
    expect(result.current).toBe(false);
    act(() => ctrl.trigger(true));
    expect(result.current).toBe(true);
    act(() => ctrl.trigger(false));
    expect(result.current).toBe(false);
  });

  it("är SSR-safe — returnerar default-värdet när matchMedia saknas", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result } = renderHook(() => useMediaQuery("(max-width: 768px)", false));
    expect(result.current).toBe(false);
  });

  it("avregistrerar listener vid unmount", () => {
    const removeSpy = vi.fn();
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "",
      addEventListener: vi.fn(),
      removeEventListener: removeSpy,
    })));
    const { unmount } = renderHook(() => useMediaQuery("(min-width: 0)"));
    unmount();
    expect(removeSpy).toHaveBeenCalled();
  });
});
