/**
 * Tester för `useAutoSync` — fokus på offline-safety, timeout och
 * state-övergångar. Vi mockar SyncProvider och driver klockan manuellt.
 *
 */

import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest-compat";
import { useAutoSync, type SyncProvider } from "@/lib/client/sync/use-auto-sync";

function makeProvider(overrides: Partial<SyncProvider> = {}): SyncProvider {
  return {
    pull: vi.fn().mockResolvedValue({ kind: "up-to-date" }),
    countChanges: vi.fn().mockResolvedValue(0),
    commitLocal: vi.fn().mockResolvedValue({ oid: null }),
    push: vi.fn().mockResolvedValue(undefined),
    commitAndPush: vi.fn().mockResolvedValue({ oid: null }),
    ...overrides,
  };
}

beforeEach(() => {
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutoSync — initial sync", () => {
  it("kör en pull vid mount och sätter state=synced när inget finns att pusha", async () => {
    const provider = makeProvider();
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true }));
    await waitFor(() => expect(result.current.state.kind).toBe("synced"));
    expect(provider.pull).toHaveBeenCalledTimes(1);
    expect(provider.commitAndPush).not.toHaveBeenCalled();
  });

  it("hoppar över sync om enabled=false", async () => {
    const provider = makeProvider();
    const { result } = renderHook(() => useAutoSync({ provider, enabled: false }));
    // Liten väntan så ev. effekter hinner — men ingenting ska hända
    await new Promise((r) => setTimeout(r, 30));
    expect(provider.pull).not.toHaveBeenCalled();
    expect(result.current.state.kind).toBe("idle");
  });

  it("hoppar över sync om provider=null", async () => {
    const { result } = renderHook(() => useAutoSync({ provider: null, enabled: true }));
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.state.kind).toBe("idle");
  });
});

describe("useAutoSync — offline-safety", () => {
  it("vid navigator.onLine=false → state=offline, ingen nät-call", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const provider = makeProvider({ countChanges: vi.fn().mockResolvedValue(3) });
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true }));
    await waitFor(() => expect(result.current.state.kind).toBe("offline"));
    if (result.current.state.kind === "offline") {
      expect(result.current.state.count).toBe(3);
    }
    expect(provider.pull).not.toHaveBeenCalled();
    expect(provider.commitAndPush).not.toHaveBeenCalled();
  });

  it("vid 'online'-event efter offline → triggar ny sync", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const provider = makeProvider();
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true }));
    await waitFor(() => expect(result.current.state.kind).toBe("offline"));

    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
    act(() => { window.dispatchEvent(new Event("online")); });
    await waitFor(() => expect(provider.pull).toHaveBeenCalled(), { timeout: 2000 });
  });
});

describe("useAutoSync — timeout-safety", () => {
  it("hängande pull triggar error-state, inte hänger UI:n", async () => {
    const provider = makeProvider({
      pull: vi.fn((): Promise<{ kind: string }> => new Promise(() => {})), // aldrig resolve
    });
    const { result } = renderHook(() => useAutoSync({
      provider, enabled: true, pullTimeoutMs: 50,
    }));
    // Manuell sync gör pull-fel synligt
    await act(async () => { await result.current.syncNow(); });
    await waitFor(() => expect(result.current.state.kind).toBe("error"), { timeout: 1000 });
  });

  it("hängande push triggar error-state", async () => {
    const provider = makeProvider({
      countChanges: vi.fn().mockResolvedValue(1),
      commitLocal: vi.fn().mockResolvedValue({ oid: "abc1234" }),
      push: vi.fn((): Promise<void> => new Promise(() => {})),
    });
    const { result } = renderHook(() => useAutoSync({
      provider, enabled: true, pushTimeoutMs: 50,
    }));
    await act(async () => { await result.current.syncNow(); });
    await waitFor(() => expect(result.current.state.kind).toBe("error"), { timeout: 1000 });
  });
});

describe("useAutoSync — commit → pull → push-ordning", () => {
  it("committar lokala ändringar INNAN pull (säkrar checkout mot dirty tree)", async () => {
    const calls: string[] = [];
    const provider = makeProvider({
      countChanges: vi.fn().mockResolvedValue(2),
      commitLocal: vi.fn(async () => { calls.push("commit"); return { oid: "c1" }; }),
      pull: vi.fn(async () => { calls.push("pull"); return { kind: "up-to-date" }; }),
      push: vi.fn(async () => { calls.push("push"); }),
    });
    renderHook(() => useAutoSync({ provider, enabled: true }));
    await waitFor(() => expect(calls).toEqual(["commit", "pull", "push"]));
  });

  it("hoppar commit/push när inga lokala ändringar finns", async () => {
    const provider = makeProvider({
      countChanges: vi.fn().mockResolvedValue(0),
      commitLocal: vi.fn().mockResolvedValue({ oid: null }),
      push: vi.fn().mockResolvedValue(undefined),
    });
    renderHook(() => useAutoSync({ provider, enabled: true }));
    await waitFor(() => expect(provider.pull).toHaveBeenCalled());
    expect(provider.commitLocal).not.toHaveBeenCalled();
    expect(provider.push).not.toHaveBeenCalled();
  });
});

describe("useAutoSync — push-debounce", () => {
  it("notifyChange triggar pending-state, sedan commit+push efter debounce", async () => {
    const provider = makeProvider({
      countChanges: vi.fn().mockResolvedValue(2),
      commitLocal: vi.fn().mockResolvedValue({ oid: "abc1234" }),
      push: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useAutoSync({
      provider, enabled: true, pushDebounceMs: 50,
    }));
    await waitFor(() => expect(provider.pull).toHaveBeenCalled());

    act(() => { result.current.notifyChange(); });
    await waitFor(() => expect(result.current.state.kind).toBe("pending"));
    await waitFor(() => expect(provider.push).toHaveBeenCalled(), { timeout: 2000 });
  });

  it("flera notifyChange i rad debouncar — bara EN push", async () => {
    const provider = makeProvider({
      countChanges: vi.fn().mockResolvedValue(1),
      commitLocal: vi.fn().mockResolvedValue({ oid: "abc1234" }),
      push: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useAutoSync({
      provider, enabled: true, pushDebounceMs: 50,
    }));
    await waitFor(() => expect(provider.pull).toHaveBeenCalled());

    act(() => {
      result.current.notifyChange();
      result.current.notifyChange();
      result.current.notifyChange();
    });
    await waitFor(() => expect(provider.push).toHaveBeenCalledTimes(1), { timeout: 1000 });
  });
});

describe("useAutoSync — single-flight", () => {
  it("syncNow medan en pull pågår körs inte parallellt", async () => {
    let resolvePull: () => void = () => {};
    const pullPromise = new Promise<{ kind: string }>((r) => {
      resolvePull = () => r({ kind: "up-to-date" });
    });
    const provider = makeProvider({ pull: vi.fn(() => pullPromise) });
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true }));

    // Initial sync triggas — pull hänger
    await waitFor(() => expect(provider.pull).toHaveBeenCalledTimes(1));

    // syncNow medan första pågår → ska inte starta en till
    await act(async () => { await result.current.syncNow(); });
    expect(provider.pull).toHaveBeenCalledTimes(1);

    // Släpp första pull → den ska kunna slutföras
    act(() => { resolvePull(); });
    await waitFor(() => expect(result.current.state.kind).toBe("synced"));
  });
});

describe("useAutoSync — merge-needed", () => {
  it("pull returnerar merge-needed → state=merge-needed", async () => {
    const provider = makeProvider({
      pull: vi.fn().mockResolvedValue({ kind: "merge-needed" }),
    });
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true }));
    await waitFor(() => expect(result.current.state.kind).toBe("merge-needed"));
    expect(provider.commitAndPush).not.toHaveBeenCalled();
  });
});

describe("useAutoSync — felbesked, intervallet och offline (#1905)", () => {
  const cases: Array<[unknown, RegExp]> = [
    [new Error("ENOENT: no such file"), /Pull: Mappen är inte ett git-repo/],
    [new Error("A requested file or directory could not be found"), /Pull: Mappen är inte ett git-repo/],
    [new Error("HTTP Error: 401 Unauthorized"), /Pull: GitHub-token avvisades \(401\)/],
    [new Error("HTTP Error: 404 Not Found"), /Pull: Repo eller branch hittades inte \(404\)/],
    [new Error("TypeError: Failed to fetch"), /Pull: Nät-fel \(Failed to fetch\)/],
    [new Error("blocked by CORS policy"), /Pull: CORS-fel/],
    [new Error("något annat"), /^Pull: något annat$/],
    ["en sträng", /^Pull: en sträng$/],
  ];

  for (const [err, expected] of cases) {
    it(`pull som kastar ${String(err)} → begripligt besked`, async () => {
      const provider = makeProvider({ pull: vi.fn().mockRejectedValue(err) });
      const { result } = renderHook(() => useAutoSync({ provider, enabled: true }));
      await waitFor(() => expect(result.current.state.kind).toBe("error"));
      const state = result.current.state;
      expect(state.kind === "error" ? state.message : "").toMatch(expected);
    });
  }

  it("intervallet kör en ny synk medan hooken är aktiv och online", async () => {
    const provider = makeProvider();
    const { unmount } = renderHook(() => useAutoSync({ provider, enabled: true, pullIntervalMs: 40 }));
    await waitFor(() => expect((provider.pull as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    unmount();
  });

  it("offline och räkningen misslyckas → offline med 0 ändringar", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const provider = makeProvider({ countChanges: vi.fn().mockRejectedValue(new Error("trasig")) });
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true }));
    await waitFor(() => expect(result.current.state).toEqual({ kind: "offline", count: 0 }));
  });

  it("en ändring medan man är offline visar offline med antalet ändringar", async () => {
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    const provider = makeProvider({ countChanges: vi.fn().mockResolvedValue(2) });
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true, pushDebounceMs: 60_000 }));
    await waitFor(() => expect(result.current.state.kind).toBe("offline"));
    act(() => { result.current.notifyChange(); });
    await waitFor(() => expect(result.current.state).toEqual({ kind: "offline", count: 2 }));
  });

  it("syncNow efter en ändring synkar direkt i stället för att vänta på fördröjningen", async () => {
    const provider = makeProvider();
    const { result } = renderHook(() => useAutoSync({ provider, enabled: true, pushDebounceMs: 60_000 }));
    await waitFor(() => expect(result.current.state.kind).toBe("synced"));
    act(() => { result.current.notifyChange(); });
    await act(async () => { await result.current.syncNow(); });
    expect(provider.pull).toHaveBeenCalledTimes(2);
  });
});
