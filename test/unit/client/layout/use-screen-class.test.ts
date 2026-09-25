import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { useScreenClass } from "@/lib/client/layout/use-screen-class";

const resizeTo = (w: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
  window.dispatchEvent(new Event("resize"));
};

describe("useScreenClass", () => {
  it("följer fönstrets bredd — laptop ↔ stor skärm ↔ telefon", () => {
    resizeTo(1470);
    const { result, unmount } = renderHook(() => useScreenClass());
    expect(result.current).toBe("laptop");
    act(() => resizeTo(2560));
    expect(result.current).toBe("large");
    act(() => resizeTo(390));
    expect(result.current).toBe("phone");
    unmount();
  });
});
