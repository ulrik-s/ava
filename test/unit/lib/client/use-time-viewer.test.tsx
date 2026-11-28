/**
 * useTimeViewer (#2114) — tittaren på Tidregistrering: okänd tills
 * `user.current` har svarat, sedan den inloggades id och om rollen ser allas.
 */
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest-compat";
import { timeViewerOf, useTimeViewer } from "@/lib/client/use-time-viewer";
import { fakeTrpcWrapper, never } from "../../../helpers/trpc-fake";

let current: { id: string; role: string } | undefined;

/** Kör hooken under en fejkad länk; utan `current` svarar `user.current` aldrig. */
function renderViewer() {
  const { wrapper } = fakeTrpcWrapper({ "user.current": () => current ?? never() });
  return renderHook(() => useTimeViewer(), { wrapper });
}

beforeEach(() => {
  current = undefined;
});

describe("useTimeViewer", () => {
  it("är loading innan user.current har svarat", () => {
    const { result } = renderViewer();
    expect(result.current).toEqual({ status: "loading" });
  });

  it("en Admin ser allas tider", async () => {
    current = { id: "u2", role: "ADMIN" };
    const { result } = renderViewer();
    await waitFor(() => expect(result.current).toEqual({ status: "ready", selfId: "u2", seesAll: true }));
  });

  it("en Advokat ser bara sina egna", async () => {
    current = { id: "u1", role: "LAWYER" };
    const { result } = renderViewer();
    await waitFor(() => expect(result.current).toEqual({ status: "ready", selfId: "u1", seesAll: false }));
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
