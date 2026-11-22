import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest-compat";
import { useScreenClass } from "@/lib/client/layout/use-screen-class";

type Listener = () => void;

/**
 * Stubbad `matchMedia` som utvärderar `(min-width: N px|rem)` mot en bredd som
 * testet styr, och som räknar lyssnarna (förebild: use-media-query.test.tsx).
 */
function mockMatchMedia(initialWidth: number) {
  const listeners = new Set<Listener>();
  let width = initialWidth;
  const matches = (query: string): boolean => {
    const m = /^\(min-width: (\d+(?:\.\d+)?)(px|rem)\)$/.exec(query);
    if (!m?.[1]) return false;
    return width >= Number(m[1]) * (m[2] === "rem" ? 16 : 1);
  };
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    get matches() { return matches(query); },
    media: query,
    addEventListener: (_e: string, cb: Listener) => listeners.add(cb),
    removeEventListener: (_e: string, cb: Listener) => listeners.delete(cb),
  })));
  return {
    listeners,
    resizeTo: (w: number) => { width = w; listeners.forEach((cb) => cb()); },
  };
}

describe("useScreenClass", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("följer media-frågorna — laptop ↔ stor skärm ↔ telefon", () => {
    const mm = mockMatchMedia(1470);
    const { result, unmount } = renderHook(() => useScreenClass());
    expect(result.current).toBe("laptop");
    act(() => mm.resizeTo(2560));
    expect(result.current).toBe("large");
    act(() => mm.resizeTo(390));
    expect(result.current).toBe("phone");
    unmount();
  });

  it("matchMedia vinner över innerWidth när de är oense", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 2560 });
    mockMatchMedia(0);
    const { result, unmount } = renderHook(() => useScreenClass());
    expect(result.current).toBe("phone");
    unmount();
  });

  it("en bredd med decimaler (767,5 vid zoom) ger samma svar som md:", () => {
    mockMatchMedia(767.5);
    const mdApplies = window.matchMedia("(min-width: 48rem)").matches;
    const { result, unmount } = renderHook(() => useScreenClass());
    expect(result.current === "phone").toBe(!mdApplies);
    unmount();
  });

  it("utan matchMedia blir värdet laptop", () => {
    vi.stubGlobal("matchMedia", undefined);
    const { result, unmount } = renderHook(() => useScreenClass());
    expect(result.current).toBe("laptop");
    unmount();
  });

  it("lyssnarna tas bort när komponenten avmonteras", () => {
    const mm = mockMatchMedia(1470);
    const { unmount } = renderHook(() => useScreenClass());
    expect(mm.listeners.size).toBeGreaterThan(0);
    unmount();
    expect(mm.listeners.size).toBe(0);
  });
});
