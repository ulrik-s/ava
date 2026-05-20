/**
 * Tester för `useOnlineStatus`.
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOnlineStatus } from "@/lib/sync/use-online-status";

describe("useOnlineStatus", () => {
  it("returnerar initialt navigator.onLine-värdet", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("uppdateras till false vid 'offline'-event", () => {
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(result.current).toBe(false);
  });

  it("uppdateras till true vid 'online'-event", () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(false);
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(result.current).toBe(true);
  });
});
