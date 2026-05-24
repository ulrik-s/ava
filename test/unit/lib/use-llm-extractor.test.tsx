/**
 * Tester för `useLlmExtractor`-hooken.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLlmExtractor } from "@/client/lib/use-llm-extractor";
import { NoopExtractor, StubExtractor } from "@/server/llm/llm-extractor";

const schema = { titel: { type: "string?" as const, description: "Dokumentets titel" } };

describe("useLlmExtractor", () => {
  it("status börjar i ready när Noop är isReady", () => {
    const { result } = renderHook(() => useLlmExtractor(() => new NoopExtractor()));
    expect(result.current.status).toBe("ready");
    expect(result.current.isReady).toBe(true);
  });

  it("warmup() går idle → warming → ready", async () => {
    const stub = new StubExtractor({});
    const { result } = renderHook(() => useLlmExtractor(() => stub));
    await act(async () => { await result.current.warmup(); });
    expect(result.current.status).toBe("ready");
  });

  it("extract() returnerar resultat och rapporterar status", async () => {
    const { result } = renderHook(() =>
      useLlmExtractor(() => new StubExtractor({ titel: "Test-titel" })),
    );
    let out: unknown;
    await act(async () => { out = await result.current.extract("text", schema); });
    expect(out).toEqual({ titel: "Test-titel" });
    expect(result.current.status).toBe("ready");
  });

  it("extract() error → status = 'error'", async () => {
    const { result } = renderHook(() =>
      useLlmExtractor(() => new StubExtractor({}, { throwOn: "extract" })),
    );
    await act(async () => {
      await result.current.extract("x", schema).catch(() => undefined);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toMatch(/extract-fel/);
  });

  it("flera extract:s i rad ackumulerar inte fel-state om de lyckas", async () => {
    const stub = new StubExtractor({ titel: "ok" });
    const { result } = renderHook(() => useLlmExtractor(() => stub));
    await act(async () => { await result.current.extract("x", schema); });
    await act(async () => { await result.current.extract("y", schema); });
    expect(result.current.status).toBe("ready");
    expect(result.current.error).toBeNull();
    expect(stub.calls).toHaveLength(2);
  });

  it("factory anropas exakt en gång per komponent-instans (lazy init)", () => {
    const factory = vi.fn(() => new NoopExtractor());
    const { rerender } = renderHook(() => useLlmExtractor(factory));
    rerender();
    rerender();
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
