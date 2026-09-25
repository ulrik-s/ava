/**
 * `ServerFirstSync` — ändringar synkas direkt efter att de sparats, läget syns,
 * och man varnas om man stänger fliken innan allt nått servern.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest-compat";
import { ServerFirstSync, type SyncableStore } from "@/components/shell/server-first-sync";
import { flushServerSync } from "@/lib/client/sync/server-sync-flush";

function fakeStore(opts: { pending: number; fail?: boolean }) {
  const state = { pending: opts.pending, reconciles: 0, listener: null as null | (() => void) };
  const store: SyncableStore = {
    reconcile: async () => {
      state.reconciles++;
      if (opts.fail) throw new Error("nätverksfel");
      state.pending = 0;
      return { pulled: 0, pushed: 1, rebased: 0, conflicts: [], cursor: 1 };
    },
    pendingCount: () => state.pending,
    onLocalChange: (l: () => void) => { state.listener = l; return () => { state.listener = null; }; },
  };
  return { state, store };
}

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("ServerFirstSync", () => {
  it("flushServerSync synkar via den monterade synken (#1176)", async () => {
    const { state, store } = fakeStore({ pending: 0 });
    const { unmount } = wrap(<ServerFirstSync store={store} />);
    await waitFor(() => expect(state.reconciles).toBe(1));
    state.pending = 1;
    await flushServerSync();
    expect(state.reconciles).toBe(2);
    unmount();
    await flushServerSync(); // avregistrerad → no-op
    expect(state.reconciles).toBe(2);
  });

  it("flushServerSync kastar när ändringar inte når servern", async () => {
    const { store } = fakeStore({ pending: 1, fail: true });
    const { unmount } = wrap(<ServerFirstSync store={store} />);
    await expect(flushServerSync()).rejects.toThrow(/inte nått servern/);
    unmount();
  });

  it("synkar köade ändringar direkt vid start och visar att allt är sparat", async () => {
    const { state, store } = fakeStore({ pending: 2 });
    wrap(<ServerFirstSync store={store} />);
    await waitFor(() => expect(state.reconciles).toBeGreaterThanOrEqual(1));
    await waitFor(() => expect(screen.getByText(/Sparat/)).toBeInTheDocument());
  });

  it("en lokal ändring triggar en ny synk", async () => {
    const { state, store } = fakeStore({ pending: 0 });
    wrap(<ServerFirstSync store={store} />);
    await waitFor(() => expect(state.reconciles).toBe(1));
    state.pending = 1;
    act(() => state.listener?.());
    await waitFor(() => expect(state.reconciles).toBe(2), { timeout: 3000 });
  });

  it("varnar vid stängning av fliken när ändringar inte nått servern", async () => {
    const { store } = fakeStore({ pending: 1, fail: true });
    wrap(<ServerFirstSync store={store} />);
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("ingen varning när allt är synkat", async () => {
    const { state, store } = fakeStore({ pending: 0 });
    wrap(<ServerFirstSync store={store} />);
    await waitFor(() => expect(state.reconciles).toBe(1));
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it("offline: försöker inte synka, visar att ändringar väntar — synkar när nätet kommer tillbaka (ADR 0016)", async () => {
    let online = false;
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "onLine");
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => online });
    try {
      const { state, store } = fakeStore({ pending: 2 });
      wrap(<ServerFirstSync store={store} />);
      await waitFor(() => expect(screen.getByText(/väntar|offline|lokalt/i)).toBeInTheDocument());
      expect(state.reconciles).toBe(0);

      online = true;
      act(() => { window.dispatchEvent(new Event("online")); });
      await waitFor(() => expect(state.reconciles).toBe(1));
      await waitFor(() => expect(screen.getByText(/Sparat/)).toBeInTheDocument());
    } finally {
      delete (navigator as { onLine?: boolean }).onLine;
      if (original) Object.defineProperty(Navigator.prototype, "onLine", original);
    }
  });

  it("utan store (demo) renderas inget", () => {
    const { container } = wrap(<ServerFirstSync store={null} />);
    expect(container.textContent).toBe("");
  });
});
