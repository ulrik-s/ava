/**
 * "Nytt i AVA" (#2010) i klienten: nyheterna hämtas bara när servern
 * annonserar `releaseNotes`, och den senast sedda versionen sparas per enhet
 * (utan lagring visas nyheterna igen — inget fel).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

let enabled = true;
const list = vi.fn(() => Promise.resolve([{ version: "v0.7.55", date: "2026-11-23", items: ["Ny knapp."] }]));
vi.mock("@/lib/client/capabilities/use-capabilities", () => ({ useCapabilities: () => ({ releaseNotes: enabled }) }));
vi.mock("@/lib/client/backend/server-trpc-client", () => ({ serverTrpcClient: () => ({ releaseNotes: { list: { query: list } } }) }));

const { readSeenRelease, RELEASE_NOTES_SEEN_KEY, useReleaseNotes, writeSeenRelease } = await import("@/lib/client/backend/server-release-notes");

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
);

beforeEach(() => {
  localStorage.clear();
  list.mockClear();
  enabled = true;
});

describe("useReleaseNotes", () => {
  it("hämtar nyheterna från servern", async () => {
    const { result } = renderHook(() => useReleaseNotes(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ version: "v0.7.55", date: "2026-11-23", items: ["Ny knapp."] }]));
  });

  it("utan förmågan frågas servern aldrig", () => {
    enabled = false;
    const { result } = renderHook(() => useReleaseNotes(), { wrapper });
    expect(result.current.data).toBeUndefined();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("senast sedda versionen", () => {
  it("sparas och läses per enhet", () => {
    expect(readSeenRelease()).toBeNull();
    writeSeenRelease("v0.7.55");
    expect(localStorage.getItem(RELEASE_NOTES_SEEN_KEY)).toBe("v0.7.55");
    expect(readSeenRelease()).toBe("v0.7.55");
  });

  it("utan lagring: null och inget fel", () => {
    const broken = { getItem: () => { throw new Error("blockerad"); }, setItem: () => { throw new Error("full"); } };
    expect(readSeenRelease(broken)).toBeNull();
    expect(() => writeSeenRelease("v1.0.0", broken)).not.toThrow();
  });
});
