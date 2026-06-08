/**
 * Tester för `DemoModeContext` + `useIsReadOnly()`.
 */

import { describe, it, expect } from "vitest-compat";
import { renderHook } from "@testing-library/react";
import { DemoModeProvider, useIsReadOnly } from "@/lib/client/demo/demo-mode-context";

describe("useIsReadOnly", () => {
  it("default = false utan provider", () => {
    const { result } = renderHook(() => useIsReadOnly());
    expect(result.current).toBe(false);
  });

  it("returnerar true när provider sätter readOnly=true", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DemoModeProvider readOnly>{children}</DemoModeProvider>
    );
    const { result } = renderHook(() => useIsReadOnly(), { wrapper });
    expect(result.current).toBe(true);
  });

  it("returnerar false när provider sätter readOnly=false", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DemoModeProvider readOnly={false}>{children}</DemoModeProvider>
    );
    const { result } = renderHook(() => useIsReadOnly(), { wrapper });
    expect(result.current).toBe(false);
  });

  it("default-readOnly = true när inga props skickas", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <DemoModeProvider>{children}</DemoModeProvider>
    );
    const { result } = renderHook(() => useIsReadOnly(), { wrapper });
    expect(result.current).toBe(true);
  });
});
