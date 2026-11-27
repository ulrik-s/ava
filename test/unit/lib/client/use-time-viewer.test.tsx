/**
 * useTimeViewer (#2114) — tittaren på Tidregistrering: okänd tills
 * `user.current` har svarat, sedan den inloggades id och om rollen ser allas.
 */
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest-compat";

let current: { id: string; role: string } | undefined;

vi.mock("@/lib/client/trpc", () => ({
  trpc: { user: { current: { useQuery: () => ({ data: current }) } } },
}));

const { useTimeViewer, timeViewerOf } = await import("@/lib/client/use-time-viewer");

beforeEach(() => {
  current = undefined;
});

describe("useTimeViewer", () => {
  it("är loading innan user.current har svarat", () => {
    const { result } = renderHook(() => useTimeViewer());
    expect(result.current).toEqual({ status: "loading" });
  });

  it("en Admin ser allas tider", () => {
    current = { id: "u2", role: "ADMIN" };
    const { result } = renderHook(() => useTimeViewer());
    expect(result.current).toEqual({ status: "ready", selfId: "u2", seesAll: true });
  });

  it("en Advokat ser bara sina egna", () => {
    current = { id: "u1", role: "LAWYER" };
    const { result } = renderHook(() => useTimeViewer());
    expect(result.current).toEqual({ status: "ready", selfId: "u1", seesAll: false });
  });
});

describe("timeViewerOf", () => {
  it("en okänd roll räknas inte som Admin", () => {
    expect(timeViewerOf({ id: "u3", role: "SUPERUSER" })).toEqual({ status: "ready", selfId: "u3", seesAll: false });
  });

  it("ett tomt id är fortfarande loading", () => {
    expect(timeViewerOf({ id: "", role: "ADMIN" })).toEqual({ status: "loading" });
  });
});
